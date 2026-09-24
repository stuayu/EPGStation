/**
 * 音声トラックの選択を「適用して、反映されたか読み返す」ためのユーティリティ。
 *
 * HLS の音声レンディション切替は代入 (`hls.audioTrack = n` / `audioTracks[n].enabled = true`) で行うが、
 * **代入しただけでは反映されないことがある**。hls.js はマスタープレイリストの解析途中や
 * レベル切替の直後に音声トラック一覧を組み直すため、その最中の代入は既定トラックへ戻される。
 * 反映されたかを読み返し、駄目なら数回やり直す。最後まで反映できなければ呼び出し側が
 * 従来の「ストリーム再生成による切替」へ落とせるよう false を返す。
 */

/** 反映されなかった場合にやり直す既定回数 */
export const DEFAULT_APPLY_RETRY_COUNT = 5;
/** やり直しの既定間隔 (ms) */
export const DEFAULT_APPLY_RETRY_INTERVAL = 200;

const defaultWait = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 選択を適用し、実際に反映されたことを確かめる (反映されていなければやり直す)
 * @param apply: () => void 選択の適用
 * @param isApplied: () => boolean 反映されたか
 * @param retryCount: number やり直す回数
 * @param intervalMs: number やり直しの間隔 (ms)
 * @param wait: (ms: number) => Promise<void> 待機処理 (テスト用に差し替え可能)
 * @return Promise<boolean> 反映できた場合 true
 */
export const applyAudioTrackWithRetry = async (
    apply: () => void,
    isApplied: () => boolean,
    retryCount: number = DEFAULT_APPLY_RETRY_COUNT,
    intervalMs: number = DEFAULT_APPLY_RETRY_INTERVAL,
    wait: (ms: number) => Promise<void> = defaultWait,
): Promise<boolean> => {
    const times = Math.max(1, retryCount);
    for (let attempt = 0; attempt < times; attempt++) {
        apply();
        if (isApplied() === true) {
            return true;
        }
        if (attempt < times - 1) {
            await wait(intervalMs);
        }
    }

    return isApplied();
};
