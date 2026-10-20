let offlineStartup = false;
let offlineApiCacheFallback = false;
let offlineApiCacheFallbackAt: number | null = null;
let offlineApiCacheUnavailable = false;

/** 起動時にサーバーを使えない状態かを共有する。 */
export const setOfflineStartup = (value: boolean): void => {
    offlineStartup = value;
};

export const setOfflineApiCacheFallback = (value: boolean, savedAt: number | null = null): void => {
    offlineApiCacheFallback = value;
    offlineApiCacheFallbackAt = value ? savedAt : null;
};

export const getOfflineApiCacheFallbackAt = (): number | null => offlineApiCacheFallbackAt;
export const setOfflineApiCacheUnavailable = (value: boolean): void => {
    offlineApiCacheUnavailable = value;
};
export const isOfflineApiCacheUnavailable = (): boolean => offlineApiCacheUnavailable;

/** オフライン起動中か。navigator.onLine は実ネットワーク断を即時反映しない場合がある。 */
export const isOfflineStartup = (): boolean => offlineStartup || offlineApiCacheFallback || navigator.onLine === false;
