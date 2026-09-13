import { inject, injectable } from 'inversify';
import IConfigFile, { HardwareEncoderSetting } from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILoggerModel from '../ILoggerModel';
import { StreamEncoderCapability } from '../../util/StreamArgsUtil';
import IHardwareEncoderProcessExecutor, { HardwareEncoderProcessResult } from './IHardwareEncoderProcessExecutor';
import IHardwareEncoderDetector, {
    HardwareEncoderDetectionResult,
    HardwareEncoderId,
    HardwareEncoderInfo,
} from './IHardwareEncoderDetector';

const RIGAYA: Readonly<
    Record<
        'qsv' | 'nvenc' | 'vce',
        { configKey: 'qsvencc' | 'nvencc' | 'vceencc'; names: string[]; provider: 'qsvencc' | 'nvencc' | 'vceencc' }
    >
> = {
    qsv: { configKey: 'qsvencc', names: ['QSVEncC64.exe', 'QSVEncC.exe', 'QSVEncC'], provider: 'qsvencc' },
    nvenc: { configKey: 'nvencc', names: ['NVEncC64.exe', 'NVEncC.exe', 'NVEncC'], provider: 'nvencc' },
    vce: { configKey: 'vceencc', names: ['VCEEncC64.exe', 'VCEEncC.exe', 'VCEEncC'], provider: 'vceencc' },
};
const FFMPEG_CODECS: Readonly<Record<Exclude<HardwareEncoderId, 'software'>, { h264: string; hevc: string }>> = {
    qsv: { h264: 'h264_qsv', hevc: 'hevc_qsv' },
    nvenc: { h264: 'h264_nvenc', hevc: 'hevc_nvenc' },
    vce: { h264: 'h264_amf', hevc: 'hevc_amf' },
    videotoolbox: { h264: 'h264_videotoolbox', hevc: 'hevc_videotoolbox' },
};

const configuredValue = (config: IConfigFile): HardwareEncoderSetting => config.hardwareEncoder ?? 'auto';

/** 起動時に一度だけ実機のエンコーダ能力を調べる。 */
@injectable()
export default class HardwareEncoderDetector implements IHardwareEncoderDetector {
    private result: HardwareEncoderDetectionResult = {
        configured: 'auto',
        selected: 'software',
        available: ['software'],
        encoders: [{ id: 'software', provider: 'software', codecs: ['h264', 'hevc'] }],
    };
    private detected = false;

    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IHardwareEncoderProcessExecutor') private readonly executor: IHardwareEncoderProcessExecutor,
    ) {
        this.log = logger.getLogger();
    }

    private readonly log: ReturnType<ILoggerModel['getLogger']>;

    public async detect(): Promise<HardwareEncoderDetectionResult> {
        if (this.detected === true) return this.result;
        this.detected = true;
        const config = this.configuration.getConfig();
        const ffmpeg = await this.probeFfmpeg(config.ffmpeg);
        const infos: HardwareEncoderInfo[] = [];

        for (const id of ['qsv', 'nvenc', 'vce'] as const) {
            const rigaya = await this.probeRigaya(config, id);
            if (rigaya !== null) {
                infos.push(rigaya);
                continue;
            }
            const codecs = this.codecsFor(ffmpeg, id);
            if (codecs.length > 0) infos.push({ id, provider: 'ffmpeg', codecs });
        }
        const videotoolboxCodecs = this.codecsFor(ffmpeg, 'videotoolbox');
        if (videotoolboxCodecs.length > 0)
            infos.push({ id: 'videotoolbox', provider: 'ffmpeg', codecs: videotoolboxCodecs });

        const encoders: HardwareEncoderInfo[] = [
            ...infos,
            { id: 'software', provider: 'software', codecs: ['h264', 'hevc'] },
        ];
        const available = encoders.map(info => info.id);
        const configured = configuredValue(config);
        const selected = this.select(configured, infos, available);
        this.result = { configured, selected, available, encoders };
        this.log.system.info(
            `hardware encoder detection: configured=${configured} available=${available.join(',')} selected=${selected} provider=${this.infoFor(selected)?.provider ?? 'software'}`,
        );
        return this.result;
    }

    public getResult(): HardwareEncoderDetectionResult {
        return this.result;
    }

    public getAvailableIds(): HardwareEncoderId[] {
        return [...this.result.available];
    }

    public getStreamEncoder(codec: 'h264' | 'hevc'): StreamEncoderCapability {
        const info = this.infoFor(this.result.selected) ?? this.infoFor('software');
        if (info === undefined || info.provider === 'software') {
            return { kind: 'ffmpeg', codecs: [codec], bitDepths: [8, 10], hdr: false };
        }
        if (info.provider === 'ffmpeg') {
            if (info.id === 'software') {
                return { kind: 'ffmpeg', codecs: [codec], bitDepths: [8, 10], hdr: false };
            }
            if (info.codecs.includes(codec) === false) {
                return { kind: 'ffmpeg', codecs: [codec], bitDepths: [8, 10], hdr: false };
            }
            return {
                kind: 'ffmpeg',
                codecs: info.codecs,
                bitDepths: [8],
                hdr: false,
                ffmpegCodecs: FFMPEG_CODECS[info.id][codec],
            };
        }
        return { kind: info.provider, command: info.command, codecs: info.codecs, bitDepths: [8, 10], hdr: true };
    }

    private infoFor(id: HardwareEncoderId): HardwareEncoderInfo | undefined {
        return this.result.encoders.find(info => info.id === id);
    }

    private select(
        configured: HardwareEncoderSetting,
        infos: HardwareEncoderInfo[],
        available: HardwareEncoderId[],
    ): HardwareEncoderId {
        if (configured !== 'auto') {
            if (available.includes(configured)) return configured;
            this.log.system.warn(`hardware encoder ${configured} is unavailable; falling back to software`);
            return 'software';
        }
        const priority: HardwareEncoderId[] =
            process.platform === 'darwin'
                ? ['videotoolbox', 'qsv', 'nvenc', 'vce']
                : ['qsv', 'nvenc', 'vce', 'videotoolbox'];
        return priority.find(id => infos.some(info => info.id === id)) ?? 'software';
    }

    private async probeFfmpeg(command: string): Promise<string> {
        const result = await this.run(command, ['-hide_banner', '-encoders']);
        return result.exitCode === 0 ? `${result.stdout}\n${result.stderr}` : '';
    }

    private async probeRigaya(config: IConfigFile, id: 'qsv' | 'nvenc' | 'vce'): Promise<HardwareEncoderInfo | null> {
        const definition = RIGAYA[id];
        const configured = config[definition.configKey];
        const candidates = configured !== undefined ? [configured] : definition.names;
        for (const candidate of candidates) {
            const result = await this.run(candidate, ['--check-hw']);
            const output = `${result.stdout}\n${result.stderr}`.trim();
            if (result.exitCode === 0 && output !== '' && this.isFailureOutput(output) === false) {
                return { id, provider: definition.provider, command: candidate, codecs: ['h264', 'hevc'] };
            }
        }
        return null;
    }

    private async run(command: string, args: readonly string[]): Promise<HardwareEncoderProcessResult> {
        try {
            return await this.executor.run(command, args, 3000);
        } catch {
            return { exitCode: null, stdout: '', stderr: '' };
        }
    }

    private codecsFor(output: string, id: Exclude<HardwareEncoderId, 'software'>): Array<'h264' | 'hevc'> {
        const codecs = FFMPEG_CODECS[id];
        return (['h264', 'hevc'] as const).filter(codec =>
            new RegExp(`\\b${this.escapeRegExp(codecs[codec])}\\b`, 'u').test(output),
        );
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    }

    private isFailureOutput(output: string): boolean {
        return /(?:not found|not available|unsupported|cannot|failed|error:|no device)/iu.test(output);
    }
}
