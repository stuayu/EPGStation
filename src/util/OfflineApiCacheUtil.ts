export interface OfflineApiCacheEntry {
    key: string;
    savedAt: number;
    accessedAt?: number;
    size: number;
}
export const OFFLINE_API_CACHE_MAX_BYTES = 30 * 1024 * 1024;
export const OFFLINE_API_CACHE_MAX_ITEMS = 500;
export const isOfflineApiCacheAllowed = (url: string): boolean => {
    const path = url
        .split('?')[0]
        .replace(/^\.\/api/, '')
        .replace(/^\/api/, '');
    return /^\/(schedules(?:\/|$)|reserves(?:\/|$)|rules(?:\/|$)|channels(?:\/|$)|config(?:\/|$))/.test(path);
};
export const createOfflineApiCacheKey = (url: string, user: string): string => `${user}:${url}`;
const OFFLINE_API_CACHE_TIME_QUERY_NAMES = new Set(['startAt', 'endAt', 'time']);

/**
 * UnixtimeMS の時刻クエリを除いた URL を返す。
 * @param url: string
 * @return string
 */
export const createOfflineApiCacheTimeInsensitiveUrl = (url: string): string => {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return url;

    const path = url.slice(0, queryIndex);
    const query = new URLSearchParams(url.slice(queryIndex + 1));
    for (const name of OFFLINE_API_CACHE_TIME_QUERY_NAMES) {
        const values = query.getAll(name);
        if (values.length > 0 && values.every(value => /^\d{13}$/.test(value))) query.delete(name);
    }
    query.sort();
    const search = query.toString();
    return search.length > 0 ? `${path}?${search}` : path;
};

/**
 * 完全一致を優先し、無ければ時刻クエリ以外が同じ最新レコードを返す。
 * @param url: string
 * @param records: OfflineApiCacheRecord[]
 * @return OfflineApiCacheRecord | null
 */
export const findOfflineApiCacheRecord = <T extends { url: string; savedAt: number; timeInsensitiveUrl?: string }>(
    url: string,
    records: T[],
): T | null => {
    const exact = records.find(record => record.url === url);
    if (exact !== undefined) return exact;

    const normalizedUrl = createOfflineApiCacheTimeInsensitiveUrl(url);
    return (
        records
            .filter(
                record =>
                    (record.timeInsensitiveUrl ?? createOfflineApiCacheTimeInsensitiveUrl(record.url)) ===
                    normalizedUrl,
            )
            .sort((a, b) => b.savedAt - a.savedAt)[0] ?? null
    );
};
export const selectOfflineApiCacheEvictions = (
    records: OfflineApiCacheEntry[],
    nextSize: number,
    maxBytes = OFFLINE_API_CACHE_MAX_BYTES,
    maxItems = OFFLINE_API_CACHE_MAX_ITEMS,
): string[] => {
    const ordered = [...records].sort((a, b) => (a.accessedAt ?? a.savedAt) - (b.accessedAt ?? b.savedAt));
    let bytes = ordered.reduce((sum, record) => sum + record.size, 0) + nextSize;
    let count = ordered.length + 1;
    const evict: string[] = [];
    while (ordered.length > 0 && (bytes > maxBytes || count > maxItems)) {
        const oldest = ordered.shift()!;
        evict.push(oldest.key);
        bytes -= oldest.size;
        count -= 1;
    }
    return evict;
};
export const isOfflineMutationBlocked = (isOffline: boolean, usedOfflineFallback: boolean): boolean =>
    isOffline || usedOfflineFallback;
