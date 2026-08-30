export interface ThumbnailCandidate {
    timestamp: number;
    index: number;
}

/** 録画長から候補時刻を均等生成する純粋ロジック。 */
export function createThumbnailCandidates(duration: number, count: number, legacyPosition = 5): ThumbnailCandidate[] {
    if (!Number.isFinite(duration) || duration <= 0) {
        return [{ timestamp: Math.max(0, legacyPosition), index: 0 }];
    }
    const safeCount = Math.max(1, Math.floor(count));
    if (duration < 10) {
        return [{ timestamp: Math.max(0, Math.min(duration * 0.5, duration - 0.05)), index: 0 }];
    }
    const start = Math.min(duration, Math.max(0, duration * 0.05));
    const end = Math.max(start, duration * 0.95);
    if (safeCount === 1) return [{ timestamp: Math.min(duration, Math.max(0, legacyPosition)), index: 0 }];
    return Array.from({ length: safeCount }, (_, index) => ({
        timestamp: start + ((end - start) * index) / (safeCount - 1),
        index,
    }));
}
