/**
 * 認証が不要なパスの判定。
 * ログイン画面自体を表示できないと詰むため、クライアントの静的ファイルと
 * 認証まわりのエンドポイントだけは素通しする。
 * パス判定はテストしやすいよう純粋関数として切り出す
 */

// 認証なしでアクセスできる API パス (subDirectory と /api を除いた後の値で判定する)
const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
    '/auth',
    '/auth/login',
    '/auth/logout',
    '/auth/setup',
    // バージョン表記はログイン画面でも出せるようにする
    '/version',
]);

/**
 * 認証なしで通してよいリクエストか
 * @param pathname: string API のベース (/api) を除いたパス。例: '/auth/login'
 * @return boolean
 */
export const isPublicApiPath = (pathname: string): boolean => {
    if (typeof pathname !== 'string' || pathname === '') return false;
    // 末尾スラッシュとクエリの揺れを吸収する
    const normalized = pathname.split('?')[0].replace(/\/+$/u, '');
    return PUBLIC_API_PATHS.has(normalized === '' ? '/' : normalized);
};

/**
 * リクエスト URL から API のパス部分を取り出す。API 以外のリクエストなら null
 * @param url: string リクエストの URL (subDirectory を含む)
 * @param apiBase: string API のベースパス (例: '/api' / '/epg/api')
 * @return string | null
 */
export const toApiPath = (url: string, apiBase: string): string | null => {
    if (typeof url !== 'string') return null;
    const pathname = url.split('?')[0];
    const base = apiBase.replace(/\/+$/u, '');
    if (pathname === base) return '/';
    if (pathname.startsWith(`${base}/`) === false) return null;
    return pathname.slice(base.length);
};
