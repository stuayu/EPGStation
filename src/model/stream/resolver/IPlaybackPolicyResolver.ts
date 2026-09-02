import { ClientCapabilities } from '../capability/IClientCapabilities';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import { PlaybackDecision } from './IPlaybackDecision';

export type PlaybackPresetScope = 'live' | 'recorded-ts' | 'recorded-encoded';

/**
 * 端末の設定画面 (クライアント) で保持している再生の既定値。
 * 明示的なプリセット指定が無いとき (auto) の自動選択に反映する
 */
export type PlaybackPreference = {
    /** HDR の扱い。preserve = 維持を優先 / sdr = SDR 変換を優先 */
    hdrMode?: 'auto' | 'preserve' | 'sdr';
    /** 映像補正。off = 補正なしを優先 / bright = 明るめの補正を優先 */
    correction?: 'auto' | 'off' | 'bright';
    /** モバイル回線では画質を下げるか */
    saveData?: boolean;
};

export default interface IPlaybackPolicyResolver {
    /** 入力・端末・候補プリセットから再生方式を決定する。 */
    resolve(
        scope: PlaybackPresetScope,
        source: SourceCapabilities,
        client: ClientCapabilities,
        presets: StreamPreset[],
        requestedPresetId?: string,
        preference?: PlaybackPreference,
    ): PlaybackDecision;
}
