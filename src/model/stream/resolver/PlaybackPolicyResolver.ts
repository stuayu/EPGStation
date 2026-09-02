import { injectable } from 'inversify';
import { ClientCapabilities } from '../capability/IClientCapabilities';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import IPlaybackPolicyResolver, { PlaybackPreference, PlaybackPresetScope } from './IPlaybackPolicyResolver';
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
        preference: PlaybackPreference = {},
    ): PlaybackDecision {
        const usable = presets.filter(preset => this.isUsable(preset, source, client));
        if (usable.length === 0) throw new Error('PlaybackProfileIsUndefined');

        const requested = usable.find(preset => preset.id === requestedPresetId);
        const selected =
            requestedPresetId !== 'auto' && requested !== undefined
                ? requested
                : this.selectAuto(usable, source, client, preference);
        const fallbackChain = usable
            .filter(preset => preset.id !== selected.id && preset.id !== 'auto')
            .sort(
                (a, b) =>
                    this.fallbackScore(b, source, client, preference) -
                    this.fallbackScore(a, source, client, preference),
            )
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

    private selectAuto(
        presets: StreamPreset[],
        source: SourceCapabilities,
        client: ClientCapabilities,
        preference: PlaybackPreference,
    ): StreamPreset {
        return (
            [...presets]
                .filter(preset => preset.id !== 'auto')
                .sort(
                    (a, b) =>
                        this.autoScore(b, source, client, preference) - this.autoScore(a, source, client, preference),
                )[0] ?? presets[0]
        );
    }

    private autoScore(
        preset: StreamPreset,
        source: SourceCapabilities,
        client: ClientCapabilities,
        preference: PlaybackPreference,
    ): number {
        const mode = this.mode(preset, source, client);
        const copyBonus = mode === 'direct-play' || mode === 'video-copy' ? 40 : 0;
        const hdrBonus = source.hdr !== 'sdr' && preset.output.hdrMode === 'preserve' ? 20 : 0;
        const resolution = preset.output.resolution === '2160p' ? 30 : preset.output.resolution === '1080p' ? 5 : 0;
        const base = QUALITY_ORDER[preset.quality] + copyBonus + hdrBonus + resolution;
        const preferenceScore = this.preferenceScore(preset, source, client, preference);
        if (this.isSavingData(client, preference) === false) {
            return base + preferenceScore;
        }

        // 通信量を優先するときは、解像度の減点が copy / HDR の加点を上回るようにする
        return (
            base - QUALITY_ORDER[preset.quality] - Math.floor(this.outputHeight(preset, source) / 4) + preferenceScore
        );
    }

    /**
     * 端末の設定画面で保持している既定値 (HDR・映像補正) を自動選択へ反映する。
     * 候補を絞り込むのではなく加減点にとどめ、設定に合う候補が 1 つも無い場合でも再生できる状態を保つ
     * @param preset: StreamPreset 評価対象のプリセット
     * @param source: SourceCapabilities 入力の映像特性
     * @param client: ClientCapabilities 端末の再生能力
     * @param preference: PlaybackPreference 端末設定
     * @return number 加減点
     */
    private preferenceScore(
        preset: StreamPreset,
        source: SourceCapabilities,
        _client: ClientCapabilities,
        preference: PlaybackPreference,
    ): number {
        let score = 0;

        // HDR: 素材が HDR のときだけ意味を持つ
        if (source.hdr !== 'sdr') {
            const isPreserve = preset.output.hdrMode === 'preserve';
            if (preference.hdrMode === 'preserve') score += isPreserve ? 60 : -60;
            else if (preference.hdrMode === 'sdr') score += isPreserve ? -60 : 60;
        }

        // 映像補正
        const correction = preset.output.videoCorrection ?? 'auto';
        if (preference.correction === 'off') score += correction === 'off' || correction === 'auto' ? 15 : -30;
        else if (preference.correction === 'bright') score += correction === 'bright' ? 30 : 0;

        return score;
    }

    /**
     * 通信量を抑える設定が実際に効く状況か。
     * 回線種別が取れない端末では効かせない
     * @param client: ClientCapabilities 端末の再生能力
     * @param preference: PlaybackPreference 端末設定
     * @return boolean
     */
    private isSavingData(client: ClientCapabilities, preference: PlaybackPreference): boolean {
        return preference.saveData === true && (client.network === 'cellular' || client.network === 'slow');
    }

    /**
     * プリセットの出力解像度 (縦) を返す
     * @param preset: StreamPreset
     * @param source: SourceCapabilities 入力の映像特性 ('source' 指定の解決に使う)
     * @return number
     */
    private outputHeight(preset: StreamPreset, source: SourceCapabilities): number {
        return preset.output.resolution === 'source'
            ? (source.height ?? 1080)
            : Number.parseInt(preset.output.resolution ?? '0', 10) || 0;
    }

    private fallbackScore(
        preset: StreamPreset,
        source: SourceCapabilities,
        client: ClientCapabilities,
        preference: PlaybackPreference,
    ): number {
        const resolution = this.outputHeight(preset, source);
        const preferenceScore = this.preferenceScore(preset, source, client, preference);

        // 端末設定を自動選択と同じ向きで効かせる。
        // 常に高画質優先のままにすると、通信量を抑える設定で選んだ低画質から再生に失敗したとき
        // 高画質へ戻ってしまう
        if (this.isSavingData(client, preference) === true) {
            return -resolution - QUALITY_ORDER[preset.quality] + preferenceScore;
        }

        return resolution + QUALITY_ORDER[preset.quality] + preferenceScore;
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
