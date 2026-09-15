export interface OfflinePlaybackPosition {
    position: number;
    duration: number;
    updatedAt: number;
}

/** オフライン動画の再生位置を保存する localStorage キーを作る。 */
export const createOfflinePlaybackPositionKey = (videoKey: string): string => `epgstation-offline-position:${videoKey}`;

/** 保存レコードから再生位置の分母となる動画長を取得する。 */
export const getOfflineVideoDurationSeconds = (record: { durationSeconds?: number; program: unknown }): number => {
    if (
        typeof record.durationSeconds === 'number' &&
        Number.isFinite(record.durationSeconds) &&
        record.durationSeconds > 0
    )
        return record.durationSeconds;
    const program = record.program as { startAt?: unknown; endAt?: unknown };
    if (typeof program.startAt !== 'number' || typeof program.endAt !== 'number') return 0;
    return Math.max(0, (program.endAt - program.startAt) / 1000);
};

/** 再生位置を保存可能な範囲へ丸める。 */
export const normalizeOfflinePlaybackPosition = (position: number, duration: number): number => {
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0;
    return Math.min(Math.max(0, position), duration);
};

/** localStorage の値から有効な再生位置を復元する。 */
export const restoreOfflinePlaybackPosition = (raw: string | null, duration: number): number | null => {
    if (raw === null) return null;
    try {
        const value: unknown = JSON.parse(raw);
        if (value === null || typeof value !== 'object') return null;
        const position = (value as { position?: unknown }).position;
        if (typeof position !== 'number' || !Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0)
            return null;
        return normalizeOfflinePlaybackPosition(position, duration);
    } catch {
        return null;
    }
};

/** localStorage へ保存する再生位置レコードを作る。 */
export const createOfflinePlaybackPosition = (
    position: number,
    duration: number,
    updatedAt: number,
): OfflinePlaybackPosition => ({
    position: normalizeOfflinePlaybackPosition(position, duration),
    duration,
    updatedAt,
});
