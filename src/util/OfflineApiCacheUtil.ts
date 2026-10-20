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
