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

// 配下すべてを認証なしで通すパス接頭辞。
// 外部 ID プロバイダ (SSO) の認可リダイレクトとコールバックは、
// ログイン前 = セッションが無い状態で必ず通るためここに含める必要がある
// (`/auth/users` などの管理 API は接頭辞が異なるので巻き込まれない)
const PUBLIC_API_PREFIXES: readonly string[] = ['/auth/oauth'];

/**
 * 認証なしで通してよいリクエストか
 * @param pathname: string API のベース (/api) を除いたパス。例: '/auth/login'
 * @return boolean
 */
export const isPublicApiPath = (pathname: string): boolean => {
    if (typeof pathname !== 'string' || pathname === '') return false;
    // 末尾スラッシュとクエリの揺れを吸収する
    const normalized = pathname.split('?')[0].replace(/\/+$/u, '');
    const target = normalized === '' ? '/' : normalized;
    if (PUBLIC_API_PATHS.has(target) === true) return true;

    return PUBLIC_API_PREFIXES.some(prefix => target === prefix || target.startsWith(`${prefix}/`));
};

// 外部プレイヤー (VLC / Infuse) や IPTV クライアントが直接開く API。
// これらは Cookie を送れないため、クエリのアクセストークンでも認証できるようにする
const MEDIA_API_PREFIXES: readonly string[] = ['/videos', '/iptv', '/streams', '/recorded'];

/**
 * クエリのアクセストークンでも認証を通してよいパスか
 * @param pathname: string API のベース (/api) を除いたパス
 * @return boolean
 */
export const isMediaApiPath = (pathname: string): boolean => {
    if (typeof pathname !== 'string' || pathname === '') return false;
    const normalized = pathname.split('?')[0].replace(/\/+$/u, '');

    return MEDIA_API_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
};

/**
 * システム管理者 (role: 'admin') だけが呼べる API のパス接頭辞。
 * 設定変更・ユーザー管理・バージョン更新など、システム全体に影響する操作を対象にする
 */
const ADMIN_API_PREFIXES: readonly string[] = [
    // システム設定 (連携トークン・通知先・ログレベルなど)
    '/settings',
    // ログインユーザーの管理
    '/auth/users',
    // バージョン更新の実行
    '/update',
    // ログ閲覧 (設定値や環境情報が出るため管理者限定にする)
    '/logs',
];

/**
 * システム管理者権限が必要な API か
 * @param pathname: string API のベース (/api) を除いたパス
 * @return boolean
 */
export const isAdminApiPath = (pathname: string): boolean => {
    if (typeof pathname !== 'string' || pathname === '') return false;
    const normalized = pathname.split('?')[0].replace(/\/+$/u, '');
    return ADMIN_API_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
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
