/**
 * Mirakurun の priority へ予約 priority を加味する。
 * @param basePriority config.yml の recPriority または conflictPriority
 * @param reservePriority 予約 priority (1〜5)
 * @return Mirakurun に渡す整数 priority
 */
export const toMirakurunPriority = (
    basePriority: number,
    reservePriority: number,
    streamingPriority: number = 0,
    isConflict: boolean = false,
    recordingBasePriority: number = basePriority,
): number => {
    const delta = Math.max(1, Math.min(5, Number.isFinite(reservePriority) ? reservePriority : 3)) - 3;
    const recordingFloor = streamingPriority + 1;
    const normalPriority = Math.max(recordingFloor + 1, recordingBasePriority + delta);
    const priority = Math.max(recordingFloor + 1, basePriority + delta);
    return isConflict ? Math.min(normalPriority - 1, Math.max(recordingFloor, basePriority + delta)) : priority;
};
