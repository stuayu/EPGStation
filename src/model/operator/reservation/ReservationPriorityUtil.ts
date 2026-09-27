/**
 * Mirakurun の priority へ予約 priority を加味する。
 * @param basePriority config.yml の recPriority または conflictPriority
 * @param reservePriority 予約 priority (1〜5)
 * @return Mirakurun に渡す整数 priority
 */
export const toMirakurunPriority = (basePriority: number, reservePriority: number): number =>
    Math.max(-1, basePriority + Math.max(1, Math.min(5, Number.isFinite(reservePriority) ? reservePriority : 3)) - 3);
