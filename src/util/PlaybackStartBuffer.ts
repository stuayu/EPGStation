/**
 * 初回再生前に確保できている前方バッファ秒数を返す。
 * @param currentTime: number 現在の再生位置 (秒)
 * @param bufferedEnd: number | null バッファ末尾 (秒)
 * @return number | null
 */
export const getBufferedAheadSeconds = (currentTime: number, bufferedEnd: number | null): number | null => {
    if (Number.isFinite(currentTime) === false || bufferedEnd === null || Number.isFinite(bufferedEnd) === false)
        return null;

    return Math.max(0, bufferedEnd - currentTime);
};

/**
 * 初回再生を開始できるだけのバッファがあるか判定する。
 * 動画全体が必要量より短い場合は、終端まで準備できた時点で開始を許可する。
 * @param currentTime: number 現在の再生位置 (秒)
 * @param bufferedEnd: number | null バッファ末尾 (秒)
 * @param duration: number | null 動画全体の長さ (秒)
 * @param requiredBufferSec: number 必要な前方バッファ (秒)
 * @return boolean
 */
export const isInitialPlaybackBufferReady = (
    currentTime: number,
    bufferedEnd: number | null,
    duration: number | null,
    requiredBufferSec: number,
): boolean => {
    if (Number.isFinite(requiredBufferSec) === false || requiredBufferSec <= 0) return false;

    const ahead = getBufferedAheadSeconds(currentTime, bufferedEnd);
    if (ahead === null) return false;
    if (ahead >= requiredBufferSec) return true;

    return (
        duration !== null &&
        Number.isFinite(duration) &&
        duration > currentTime &&
        duration - currentTime <= requiredBufferSec &&
        ahead >= duration - currentTime
    );
};
