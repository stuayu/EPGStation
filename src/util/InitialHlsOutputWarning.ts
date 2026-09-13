/**
 * in-memory HLS の初回出力待ち警告の閾値 (ms)
 */
export const INITIAL_HLS_OUTPUT_WARNING_DELAY_MS = 15_000;

/**
 * 初回のセグメントが届かないまま警告閾値へ達したか判定する。
 * @param nowMs: number 判定時刻 (ms)
 * @param startedAtMs: number パッケージング開始時刻 (ms)
 * @param hasInitialOutput: boolean セグメントが到着済みか (init の到着では true にしない)
 * @param thresholdMs: number 警告までの待ち時間 (ms)
 * @return boolean
 */
export const shouldWarnInitialHlsOutput = (
    nowMs: number,
    startedAtMs: number,
    hasInitialOutput: boolean,
    thresholdMs: number,
): boolean => {
    if (hasInitialOutput === true) return false;
    if (
        Number.isFinite(nowMs) === false ||
        Number.isFinite(startedAtMs) === false ||
        Number.isFinite(thresholdMs) === false ||
        thresholdMs <= 0
    ) {
        return false;
    }

    return nowMs - startedAtMs >= thresholdMs;
};
