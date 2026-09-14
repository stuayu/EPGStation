/**
 * MediaSource の再接続後に currentTime を寄せられるバッファ範囲。
 */
export interface PlaybackBufferedRange {
    start: number;
    end: number;
}

export const PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS = 1_000;
export const PLAYBACK_BUFFER_RECOVERY_MIN_GAP_SEC = 0.05;

/**
 * 再接続後に再生位置をバッファ先頭へ寄せるべきか判定する。
 * 初回再生や正常再生を巻き戻さないため、データが読める状態で、一定時間
 * 再生位置が進まず、currentTime が最初のバッファより手前にある場合だけ対象にする。
 * @param currentTime: number video.currentTime (秒)
 * @param buffered: PlaybackBufferedRange[] video.buffered の範囲
 * @param readyState: number video.readyState
 * @param elapsedMs: number 再生位置が進んでいない経過時間 (ミリ秒)
 * @return number | null 寄せ先。対象外なら null
 */
export const resolvePlaybackBufferRecoveryTarget = (
    currentTime: number,
    buffered: readonly PlaybackBufferedRange[],
    readyState: number,
    elapsedMs: number,
): number | null => {
    if (
        isValidPlaybackSyncPosition(currentTime) === false ||
        Number.isFinite(readyState) === false ||
        Number.isFinite(elapsedMs) === false ||
        readyState < 2 ||
        elapsedMs < PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS
    ) {
        return null;
    }

    const first = buffered[0];
    if (
        typeof first === 'undefined' ||
        isValidPlaybackSyncPosition(first.start) === false ||
        Number.isFinite(first.end) === false ||
        first.end <= first.start ||
        currentTime >= first.start - PLAYBACK_BUFFER_RECOVERY_MIN_GAP_SEC
    ) {
        return null;
    }

    return first.start;
};
import { isValidPlaybackSyncPosition } from './PlaybackSyncPositionUtil';
