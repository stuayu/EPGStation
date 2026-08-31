import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset, VideoCorrectionMode } from '../preset/IStreamPreset';

/**
 * 入力・端末能力・プリセットから決定した再生方法。
 */
export interface PlaybackDecision {
    /** 要求されたプリセット識別子。 */
    presetId: string;
    /** UI表示名。 */
    label: string;
    /** 推薦理由。 */
    reason: string;
    /** 再生方式。 */
    mode: 'direct-play' | 'remux' | 'video-copy' | 'transcode';
    /** 入力映像の能力情報。 */
    source: SourceCapabilities;
    /** 出力設定。 */
    output: StreamPreset['output'];
    /** 映像補正。 */
    correction: VideoCorrectionMode;
    /** 起動失敗時に順に試すプリセット識別子。 */
    fallbackChain: string[];
}
