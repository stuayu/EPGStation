export interface TunerTimelineItem {
    left: number;
    width: number;
}

/** 予約時刻を時間軸内のパーセント位置へ変換する */
export const getTunerTimelineItem = (
    startAt: number,
    endAt: number,
    rangeStart: number,
    rangeEnd: number,
): TunerTimelineItem | null => {
    if (rangeEnd <= rangeStart || endAt <= rangeStart || startAt >= rangeEnd || endAt <= startAt) return null;
    const clippedStart = Math.max(startAt, rangeStart);
    const clippedEnd = Math.min(endAt, rangeEnd);
    return {
        left: ((clippedStart - rangeStart) / (rangeEnd - rangeStart)) * 100,
        width: ((clippedEnd - clippedStart) / (rangeEnd - rangeStart)) * 100,
    };
};
