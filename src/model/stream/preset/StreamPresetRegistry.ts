import { inject, injectable } from 'inversify';
import { StreamContainer, StreamProfile } from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import StreamProfileManageModel from '../StreamProfileManageModel';
import { ClientCapabilities } from '../capability/IClientCapabilities';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from './IStreamPreset';
import { BUILTIN_STREAM_PRESETS, LEGACY_STREAM_PRESETS } from '../../../util/BuiltinStreamPresets';
import IStreamPresetRegistry, { StreamPresetScope } from './IStreamPresetRegistry';
import EncodePresets from '../../../util/EncodePresets';

/** Built-in、encodePresets、既存 config の配信プリセットを統合する。 */
@injectable()
export default class StreamPresetRegistry implements IStreamPresetRegistry {
    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IStreamProfileManageModel') private readonly profiles: StreamProfileManageModel,
    ) {}

    public getPresets(
        scope: StreamPresetScope,
        source: SourceCapabilities,
        client: ClientCapabilities,
    ): StreamPreset[] {
        const config = this.configuration.getConfig();
        const generated = EncodePresets.expand(config.encodePresets, {
            qsvencc: config.qsvencc,
            nvencc: config.nvencc,
            vceencc: config.vceencc,
        });
        const configured = this.getProfiles(scope);
        const generatedProfiles = this.getGeneratedProfiles(generated, scope);
        const generatedById = new Map(generatedProfiles.map(profile => [profile.id, profile]));
        const generatedConfigured = new Set(
            configured
                .filter(profile => {
                    const generatedProfile = generatedById.get(profile.id);
                    return generatedProfile !== undefined && profile.cmd === generatedProfile.cmd;
                })
                .map(profile => profile.id),
        );
        const user = configured.filter(profile => !generatedConfigured.has(profile.id));
        const userPresets = user.map(profile => this.toPreset(profile, scope));
        const userRoles = new Set(userPresets.map(presetRole));
        const auto = generatedProfiles
            .map(profile => configured.find(item => item.id === profile.id) ?? profile)
            .map(profile => this.toPreset(profile, scope))
            .filter(preset => !userRoles.has(presetRole(preset)));
        const candidates = [...userPresets, ...auto];
        const occupied = new Set(candidates.map(presetRole));
        const catalog = [...BUILTIN_STREAM_PRESETS, ...LEGACY_STREAM_PRESETS].filter(
            preset => !occupied.has(presetRole(preset)),
        );

        return [...candidates, ...catalog].filter(
            preset => this.appliesToScope(preset, scope) && this.isAvailable(preset, source, client),
        );
    }

    public getModeMap(scope: StreamPresetScope): Record<StreamContainer, string[]> {
        const result: Record<StreamContainer, string[]> = {
            m2ts: [],
            m2tsll: [],
            mp4: [],
            webm: [],
            hls: [],
        };
        for (const profile of this.getProfiles(scope)) {
            result[profile.container].push(profile.id);
        }
        return result;
    }

    public resolveMode(scope: StreamPresetScope, container: StreamContainer, mode: number): string | null {
        return this.getModeMap(scope)[container][mode] ?? null;
    }

    private getProfiles(scope: StreamPresetScope): StreamProfile[] {
        if (scope === 'live') return this.profiles.getLiveProfiles();
        return this.profiles.getRecordedProfiles(scope === 'recorded-ts' ? 'ts' : 'encoded');
    }

    private getGeneratedProfiles(
        expansion: ReturnType<typeof EncodePresets.expand>,
        scope: StreamPresetScope,
    ): StreamProfile[] {
        if (scope === 'live') return expansion.live;
        return scope === 'recorded-ts' ? expansion.recordedTs : expansion.recordedEncoded;
    }

    private toPreset(profile: StreamProfile, scope: StreamPresetScope): StreamPreset {
        const height = profile.video?.height ?? this.heightFromText(`${profile.id} ${profile.name}`);
        const codec = this.codecOf(profile);
        const outputCodec = profile.isUnconverted === true ? 'copy' : codec;
        return {
            id: profile.id,
            name: profile.isUnconverted === true ? 'オリジナル' : profile.name,
            useFor: scope === 'live' ? 'live' : 'recorded',
            quality: profile.isUnconverted === true ? 'original' : 'balanced',
            builtin: false,
            legacy: profile.id.startsWith('live-') || profile.id.startsWith('recorded-'),
            output: { codec: outputCodec, resolution: this.resolutionOf(height), container: profile.container },
        };
    }

    private codecOf(profile: StreamProfile): StreamPreset['output']['codec'] {
        const value = `${profile.video?.codec ?? ''} ${profile.cmd ?? ''}`.toLowerCase();
        if (/(?:hevc|h\.265|h265|x265|265)/.test(value)) return 'hevc';
        if (/(?:h\.264|h264|avc|x264|264)/.test(value)) return 'h264';
        if (/(?:-c:v|-codec:v)\s*(?:copy|none)/.test(value)) return 'copy';
        return undefined;
    }

    private heightFromText(value: string): number | undefined {
        const match = value.match(/(?:2160|1080|720|480|240)p/);
        return match === null ? undefined : Number.parseInt(match[0], 10);
    }

    private resolutionOf(height?: number): StreamPreset['output']['resolution'] {
        if (height === undefined) return 'source';
        if (height >= 2160) return '2160p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        return '240p';
    }

    private appliesToScope(preset: StreamPreset, scope: StreamPresetScope): boolean {
        return preset.useFor === 'both' || (scope === 'live' ? preset.useFor === 'live' : preset.useFor === 'recorded');
    }

    private isAvailable(preset: StreamPreset, source: SourceCapabilities, client: ClientCapabilities): boolean {
        const sourceConditions = preset.sourceConditions;
        if (sourceConditions?.sourceClass && !sourceConditions.sourceClass.includes(source.sourceClass)) return false;
        if (sourceConditions?.hdr && !sourceConditions.hdr.includes(source.hdr)) return false;
        if (
            sourceConditions?.minHeight !== undefined &&
            (source.height === undefined || source.height < sourceConditions.minHeight)
        )
            return false;
        if (
            sourceConditions?.maxHeight !== undefined &&
            (source.height === undefined || source.height > sourceConditions.maxHeight)
        )
            return false;
        const outputHeight = this.heightOf(preset.output.resolution);
        if (outputHeight !== undefined && source.height !== undefined && outputHeight > source.height) return false;
        if (preset.output.codec === 'hevc' && (!client.hevc || (preset.output.bitDepth === 10 && !client.hevcMain10)))
            return false;
        if (preset.output.codec === 'h264' && !client.h264) return false;
        if (
            preset.output.hdrMode === 'preserve' &&
            source.hdr !== 'sdr' &&
            (!client.hdr || (source.hdr === 'hlg' && !client.hlg))
        )
            return false;
        const clientConditions = preset.clientConditions;
        if (clientConditions?.requireHevc && !client.hevc) return false;
        if (clientConditions?.requireHevcMain10 && !client.hevcMain10) return false;
        if (clientConditions?.requireHdr && !client.hdr) return false;
        return true;
    }

    private heightOf(resolution: StreamPreset['output']['resolution']): number | undefined {
        if (resolution === undefined || resolution === 'source') return undefined;
        return Number.parseInt(resolution, 10);
    }
}

const presetRole = (preset: StreamPreset): string => {
    if (preset.id === 'auto') return 'auto';
    if (preset.id === 'original' || preset.name === 'オリジナル') return 'original';
    const resolution =
        preset.output.resolution ??
        preset.id.match(/(2160|1080|720|480|240)p/)?.[0] ??
        preset.name.match(/(2160|1080|720|480|240)p/)?.[0];
    return resolution ?? preset.id;
};
