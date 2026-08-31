import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';
import { VideoCorrectionMode } from '../model/stream/preset/IStreamPreset';

export interface VideoCorrectionContext {
    /** 出力が HDR を維持するか。 */
    hdrMode?: 'preserve' | 'tone-map' | 'sdr';
    /** ライブ入力か。ライブでは輝度解析しない。 */
    live?: boolean;
    /** 端末が HDR 表示に対応するか。 */
    clientHdr?: boolean;
}

/** 映像補正フィルタを保守的に決める。解析なしの auto は補正しない。 */
export const getVideoCorrectionFilter = (
    source: SourceCapabilities,
    mode: VideoCorrectionMode = 'auto',
    context: VideoCorrectionContext = {},
): string | null => {
    if (mode === 'off') return null;
    if (mode === 'bright') {
        // ネイティブ HDR は明るくしない。HDR→SDR はトーンマップ側で処理する。
        if (source.hdr !== 'sdr' && context.hdrMode !== 'tone-map' && context.hdrMode !== 'sdr') return null;
        return 'eq=gamma=1.05:brightness=0.02';
    }
    // HDR/色メタデータと端末能力で経路を決めても、確信のない自動補正は行わない。
    // 特にライブでは signalstats 等の輝度解析をしない。
    return null;
};

export default getVideoCorrectionFilter;
