let offlineStartup = false;

/** 起動時にサーバーを使えない状態かを共有する。 */
export const setOfflineStartup = (value: boolean): void => {
    offlineStartup = value;
};

/** オフライン起動中か。navigator.onLine は実ネットワーク断を即時反映しない場合がある。 */
export const isOfflineStartup = (): boolean => offlineStartup || navigator.onLine === false;

