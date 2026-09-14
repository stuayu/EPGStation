/** オフラインでも開けるナビゲーション先 (保存データだけで描画でき、サーバの API を呼ばない画面) */
const OFFLINE_AVAILABLE_PATH_PREFIXES = ['/offline-videos'];

/**
 * ナビゲーション項目を押せるか判定する。
 * オフライン時もサイドバー自体は表示し、サーバが要る画面だけを押せなくする
 * (サイドバーごと消すと、オフライン保存以外の画面へ戻る導線もオンライン復帰後の導線も無くなる)
 * @param href: { path?: string } | string | null 項目の遷移先
 * @param isOffline: boolean オフラインか
 * @return boolean 押せるなら true
 */
export const isNavigationItemEnabled = (href: { path?: string } | string | null, isOffline: boolean): boolean => {
    if (href === null) return false;
    if (isOffline === false) return true;
    const path = typeof href === 'string' ? href : (href.path ?? '');

    return OFFLINE_AVAILABLE_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
};
