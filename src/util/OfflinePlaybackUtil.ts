export interface OfflinePlaybackPosition {
    position: number;
    duration: number;
    updatedAt: number;
}

export const OFFLINE_MPEG_TS_PACKET_SIZE = 188;

/** 保存済み元 TS の読み出し開始位置を TS パケット境界へ揃えてクランプする。 */
export const calculateOfflineOriginalOffset = (
    position: number,
    fileSize: number,
    durationSeconds: number,
    packetSize = OFFLINE_MPEG_TS_PACKET_SIZE,
): number => {
    if (
        !Number.isSafeInteger(fileSize) ||
        fileSize <= 0 ||
        !Number.isFinite(position) ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        !Number.isSafeInteger(packetSize) ||
        packetSize <= 0
    )
        return 0;
    const normalizedPosition = Math.min(Math.max(0, position), durationSeconds);
    const estimated = Math.floor((normalizedPosition * fileSize) / durationSeconds / packetSize) * packetSize;
    return Math.min(Math.max(0, estimated), Math.max(0, fileSize - packetSize));
};

/** オフライン元 TS の offset URL を作る。既存の offset は置き換える。 */
export const createOfflineOriginalOffsetUrl = (source: string, offset: number): string => {
    const hashIndex = source.indexOf('#');
    const hash = hashIndex < 0 ? '' : source.slice(hashIndex);
    const withoutHash = hashIndex < 0 ? source : source.slice(0, hashIndex);
    const queryIndex = withoutHash.indexOf('?');
    const path = queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex);
    const query = queryIndex < 0 ? '' : withoutHash.slice(queryIndex + 1);
    const params = query.split('&').filter(item => item !== '' && item.split('=', 1)[0] !== 'offset');
    params.push(`offset=${encodeURIComponent(String(Math.max(0, Math.floor(offset))))}`);
    return `${path}?${params.join('&')}${hash}`;
};

export interface OfflineBufferedRange {
    start: number;
    end: number;
}

/** オフライン元 TS の絶対位置が現在の buffered 範囲に含まれるか判定する。 */
export const isOfflinePositionBuffered = (
    position: number,
    basePlayPosition: number,
    buffered: OfflineBufferedRange[],
): boolean => {
    if (!Number.isFinite(position) || !Number.isFinite(basePlayPosition)) return false;
    return buffered.some(range =>
        Number.isFinite(range.start) && Number.isFinite(range.end) && range.end >= range.start &&
        position >= basePlayPosition + range.start && position <= basePlayPosition + range.end,
    );
};

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

/** オフライン再生の全体長を保存値優先で解決する。 */
export const resolveOfflinePlaybackDuration = (streamDuration: number, savedDuration: number): number =>
    typeof savedDuration === 'number' && Number.isFinite(savedDuration) && savedDuration > 0
        ? savedDuration
        : streamDuration;

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
