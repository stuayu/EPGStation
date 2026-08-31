import { injectable } from 'inversify';
import { ClientCapabilities } from '../capability/IClientCapabilities';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import IPlaybackPolicyResolver, { PlaybackPresetScope } from './IPlaybackPolicyResolver';
import { PlaybackDecision } from './IPlaybackDecision';

const MAX_FALLBACKS = 3;
const QUALITY_ORDER: Record<StreamPreset['quality'], number> = {
    original: 100,
    highest: 90,
    high: 80,
    balanced: 60,
    compact: 30,
};

@injectable()
export default class PlaybackPolicyResolver implements IPlaybackPolicyResolver {
    public resolve(
        _scope: PlaybackPresetScope,
        source: SourceCapabilities,
        client: ClientCapabilities,
        presets: StreamPreset[],
        requestedPresetId = 'auto',
    ): PlaybackDecision {
        const usable = presets.filter(preset => this.isUsable(preset, source, client));
        if (usable.length === 0) throw new Error('PlaybackProfileIsUndefined');

        const requested = usable.find(preset => preset.id === requestedPresetId);
        const selected =
            requestedPresetId !== 'auto' && requested !== undefined
                ? requested
                : this.selectAuto(usable, source, client);
        const fallbackChain = usable
            .filter(preset => preset.id !== selected.id && preset.id !== 'auto')
            .sort((a, b) => this.fallbackScore(b, source) - this.fallbackScore(a, source))
            .slice(0, MAX_FALLBACKS)
            .map(preset => preset.id);

        return {
            presetId: selected.id,
            label: selected.name,
            reason: this.reason(selected, source, client),
            mode: this.mode(selected, source, client),
            source,
            output: selected.output,
            correction: selected.output.videoCorrection ?? 'auto',
            fallbackChain,
        };
    }

    private selectAuto(presets: StreamPreset[], source: SourceCapabilities, client: ClientCapabilities): StreamPreset {
        return (
            [...presets]
                .filter(preset => preset.id !== 'auto')
                .sort((a, b) => this.autoScore(b, source, client) - this.autoScore(a, source, client))[0] ?? presets[0]
        );
    }

    private autoScore(preset: StreamPreset, source: SourceCapabilities, client: ClientCapabilities): number {
        const mode = this.mode(preset, source, client);
        const copyBonus = mode === 'direct-play' || mode === 'video-copy' ? 40 : 0;
        const hdrBonus = source.hdr !== 'sdr' && preset.output.hdrMode === 'preserve' ? 20 : 0;
        const resolution = preset.output.resolution === '2160p' ? 30 : preset.output.resolution === '1080p' ? 5 : 0;
        return QUALITY_ORDER[preset.quality] + copyBonus + hdrBonus + resolution;
    }

    private fallbackScore(preset: StreamPreset, source: SourceCapabilities): number {
        const resolution =
            preset.output.resolution === 'source'
                ? (source.height ?? 0)
                : Number.parseInt(preset.output.resolution ?? '0', 10);
        return resolution + QUALITY_ORDER[preset.quality];
    }

    private isUsable(preset: StreamPreset, source: SourceCapabilities, client: ClientCapabilities): boolean {
        const output = preset.output;
        if (output.codec === 'copy' && !this.sourceCanPlay(source, client)) return false;
        if (output.codec === 'hevc' && (!client.hevc || (output.bitDepth === 10 && !client.hevcMain10))) return false;
        if (output.codec === 'h264' && !client.h264) return false;
        if (
            output.hdrMode === 'preserve' &&
            source.hdr !== 'sdr' &&
            (!client.hdr || (source.hdr === 'hlg' && !client.hlg))
        )
            return false;
        return true;
    }

    private sourceCanPlay(source: SourceCapabilities, client: ClientCapabilities): boolean {
        if (source.codec === 'hevc') return source.bitDepth !== 10 ? client.hevc : client.hevcMain10;
        if (source.codec === 'h264') return client.h264;
        return false;
    }

    private mode(
        preset: StreamPreset,
        source: SourceCapabilities,
        client: ClientCapabilities,
    ): PlaybackDecision['mode'] {
        const output = preset.output;
        if (output.codec === 'copy') return output.container === undefined ? 'direct-play' : 'remux';
        const sameCodec = output.codec === source.codec || (output.codec === 'hevc' && source.codec === 'hevc');
        const sameResolution =
            output.resolution === 'source' ||
            (output.resolution === '2160p' && (source.height ?? 0) >= 2160) ||
            (output.resolution === '1080p' && (source.height ?? 0) === 1080);
        const sameHdr = output.hdrMode === 'preserve' || (output.hdrMode === 'sdr' && source.hdr === 'sdr');
        if (sameCodec && sameResolution && sameHdr && this.sourceCanPlay(source, client)) return 'video-copy';
        return 'transcode';
    }

    private reason(preset: StreamPreset, source: SourceCapabilities, client: ClientCapabilities): string {
        if (source.hdr !== 'sdr' && preset.output.hdrMode !== 'preserve')
            return '端末に合わせて明るさと画質を調整しました';
        if (this.mode(preset, source, client) === 'direct-play' || this.mode(preset, source, client) === 'video-copy')
            return '元の映像を活かして再生できます';
        const resolution =
            preset.output.resolution === 'source' ? source.height : Number.parseInt(preset.output.resolution ?? '', 10);
        if (resolution !== undefined && resolution === source.height && resolution > 0)
            return `${resolution}pの映像に合わせて再生します`;
        if (resolution !== undefined && resolution > 0 && resolution < (source.height ?? Number.POSITIVE_INFINITY))
            return `${resolution}pに画質を下げて再生します`;
        return '再生しやすい画質を選択しました';
    }
}
