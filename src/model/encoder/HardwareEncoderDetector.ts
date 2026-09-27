import { inject, injectable } from 'inversify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import IConfigFile, { HardwareEncoderSetting } from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILoggerModel from '../ILoggerModel';
import { StreamEncoderCapability } from '../../util/StreamArgsUtil';
import IHardwareEncoderProcessExecutor, { HardwareEncoderProcessResult } from './IHardwareEncoderProcessExecutor';
import IHardwareEncoderDetector, {
    HardwareEncoderDetectionResult,
    HardwareEncoderId,
    HardwareEncoderInfo,
    HardwareDecoder,
} from './IHardwareEncoderDetector';
import { SourceCapabilities } from '../stream/capability/ISourceCapabilities';

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

/** 録画後エンコード用の環境変数に渡す選択済みプリセット名を返す。 */
export const getEncodeHardwarePreset = (capability: StreamEncoderCapability, codec: 'h264' | 'hevc'): string => {
    if (capability.ffmpegCodecs !== undefined) return capability.ffmpegCodecs;
    if (capability.kind === 'ffmpeg') return '';
    return `${capability.kind}_${codec}`;
};

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
    private toneMappingAvailable = false;
    private hevcMain10Decoder: HardwareDecoder | undefined;

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
        const filterResult = await this.run(config.ffmpeg, ['-hide_banner', '-filters']);
        const filters = `${filterResult.stdout}\n${filterResult.stderr}`;
        this.toneMappingAvailable =
            filterResult.exitCode === 0 && /\bzscale\b/u.test(filters) && /\btonemap\b/u.test(filters);
        if (this.toneMappingAvailable === false) {
            this.log.system.warn('HDR tone mapping disabled: ffmpeg lacks zscale and/or tonemap filter');
        }
        await this.detectHevcMain10Decoder(config.ffmpeg, ffmpeg);
        const infos: HardwareEncoderInfo[] = [];

        for (const id of ['qsv', 'nvenc', 'vce'] as const) {
            const rigaya = await this.probeRigaya(config, id);
            if (rigaya !== null) {
                infos.push(rigaya);
                continue;
            }
            const codecs = await this.probeFfmpegHardware(config.ffmpeg, ffmpeg, id);
            if (codecs.length > 0) infos.push({ id, provider: 'ffmpeg', codecs });
        }
        const videotoolboxCodecs = await this.probeFfmpegHardware(config.ffmpeg, ffmpeg, 'videotoolbox');
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
            `hardware encoder detection: configured=${configured} candidates=${this.detectionSummary} available=${available.join(',')} selected=${selected} provider=${this.infoFor(selected)?.provider ?? 'software'} toneMapping=${this.toneMappingAvailable}`,
        );
        return this.result;
    }

    public getResult(): HardwareEncoderDetectionResult {
        return this.result;
    }

    public getAvailableIds(): HardwareEncoderId[] {
        return [...this.result.available];
    }

    public supportsToneMapping(): boolean {
        return this.toneMappingAvailable;
    }

    public getHardwareDecoder(source: SourceCapabilities): HardwareDecoder | undefined {
        if (source.codec !== 'hevc' || (source.height ?? 0) < 2160 || (source.bitDepth ?? 0) < 10) return undefined;
        return this.hevcMain10Decoder;
    }

    private async detectHevcMain10Decoder(command: string, encoders: string): Promise<void> {
        if (/\blibx265\b/u.test(encoders) === false) {
            this.detectionSummary = [this.detectionSummary, 'hevc-main10-decode=unavailable(libx265-not-listed)'].filter(Boolean).join(' ');
            return;
        }
        const directory = await mkdtemp(join(tmpdir(), 'epgstation-hwdecode-')).catch(() => undefined);
        if (directory === undefined) return;
        const sample = join(directory, 'main10.hevc');
        try {
            const generated = await this.run(command, [
                '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:r=1:d=1',
                '-vf', 'format=yuv420p10le', '-frames:v', '1', '-c:v', 'libx265', '-profile:v', 'main10', '-x265-params', 'log-level=error', '-f', 'hevc', sample,
            ], 15000);
            if (generated.exitCode !== 0) {
                this.detectionSummary = [this.detectionSummary, 'hevc-main10-decode=unavailable(sample-generation-failed)'].filter(Boolean).join(' ');
                return;
            }
            const candidates: HardwareDecoder[] = process.platform === 'darwin'
                ? ['videotoolbox']
                : process.platform === 'win32' ? ['d3d11va', 'dxva2', 'cuda', 'qsv'] : ['vaapi', 'cuda', 'qsv'];
            for (const decoder of candidates) {
                const result = await this.run(command, [
                    '-hide_banner', '-loglevel', 'error', '-hwaccel', decoder, '-i', sample, '-frames:v', '1', '-f', 'null', '-',
                ], 5000);
                if (result.exitCode === 0) {
                    this.hevcMain10Decoder = decoder;
                    this.detectionSummary = [this.detectionSummary, `hevc-main10-decode=${decoder}`].filter(Boolean).join(' ');
                    return;
                }
            }
            this.detectionSummary = [this.detectionSummary, 'hevc-main10-decode=software'].filter(Boolean).join(' ');
        } finally {
            await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    private detectionSummary = '';

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

    private async probeFfmpegHardware(
        command: string,
        listedEncoders: string,
        id: Exclude<HardwareEncoderId, 'software'>,
    ): Promise<Array<'h264' | 'hevc'>> {
        const listed = this.codecsFor(listedEncoders, id);
        const passed: Array<'h264' | 'hevc'> = [];
        const summary: string[] = [];
        for (const codec of ['h264', 'hevc'] as const) {
            const encoder = FFMPEG_CODECS[id][codec];
            if (listed.includes(codec) === false) {
                summary.push(`${encoder}=not-listed`);
                continue;
            }
            const args = this.createHardwareProbeArgs(id, codec, encoder);
            const result = await this.run(command, args);
            const output = `${result.stderr}\n${result.stdout}`.trim();
            const success = result.exitCode === 0;
            if (success) passed.push(codec);
            const reason = success ? 'ok' : output.split(/\r?\n/u).find(line => line.trim() !== '')?.trim() ?? `exit=${result.exitCode}`;
            summary.push(`${encoder}=${success ? 'available' : `failed(${reason.slice(0, 140)})`}`);
        }
        this.detectionSummary = [this.detectionSummary, `${id}[${summary.join(';')}]`].filter(Boolean).join(' ');
        return passed;
    }

    private createHardwareProbeArgs(
        id: Exclude<HardwareEncoderId, 'software'>,
        codec: 'h264' | 'hevc',
        encoder: string,
    ): string[] {
        const format = id === 'qsv' ? 'nv12' : 'yuv420p';
        const pixFormat = id === 'qsv' ? [] : ['-pix_fmt', format];
        const profile = codec === 'h264' ? 'baseline' : 'main';
        const realtime = id === 'videotoolbox' ? ['-realtime', '1', '-allow_sw', '0'] : [];
        const preset = id === 'nvenc' ? ['-preset', 'p4'] : id === 'vce' ? ['-quality', 'speed'] : id === 'qsv' ? ['-preset', 'veryfast'] : [];
        const vf = ['-vf', id === 'qsv' ? `scale=160:120,format=${format}` : 'scale=160:120'];
        return [
            '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.1:r=30',
            '-frames:v', '1', '-an', '-c:v', encoder, '-profile:v', profile, ...pixFormat, ...vf, ...preset,
            '-b:v', '1M', '-maxrate', '1M', '-g', '15', ...realtime, '-f', 'null', '-',
        ];
    }

    private async probeRigaya(config: IConfigFile, id: 'qsv' | 'nvenc' | 'vce'): Promise<HardwareEncoderInfo | null> {
        const definition = RIGAYA[id];
        const configured = config[definition.configKey];
        const candidates = configured !== undefined ? [configured] : definition.names;
        const attempts: string[] = [];
        for (const candidate of candidates) {
            const result = await this.run(candidate, ['--check-hw']);
            const output = `${result.stdout}\n${result.stderr}`.trim();
            if (result.exitCode === 0 && output !== '' && this.isFailureOutput(output) === false) {
                this.detectionSummary = [this.detectionSummary, `${id}-rigaya=${candidate}:available`].filter(Boolean).join(' ');
                return { id, provider: definition.provider, command: candidate, codecs: ['h264', 'hevc'] };
            }
            const reason = output.split(/\r?\n/u).find(line => line.trim() !== '')?.trim() ?? `exit=${result.exitCode}`;
            attempts.push(`${candidate}:${reason.slice(0, 80)}`);
        }
        this.detectionSummary = [this.detectionSummary, `${id}-rigaya=${attempts.join('|') || 'not-found'}`].filter(Boolean).join(' ');
        return null;
    }

    private async run(command: string, args: readonly string[], timeoutMs = 3000): Promise<HardwareEncoderProcessResult> {
        try {
            return await this.executor.run(command, args, timeoutMs);
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
