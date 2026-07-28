import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Google / GitHub の OAuth 2.0 (認可コードフロー) 用の定義とヘルパー。
 * 依存を増やさないよう、URL の組み立てと state の署名だけを自前で持ち、
 * 通信は呼び出し側 (OAuthModel) が fetch で行う
 */

export type OAuthProviderId = 'google' | 'github';

export const OAUTH_PROVIDER_IDS: readonly OAuthProviderId[] = ['google', 'github'];

export interface OAuthProviderDefinition {
    id: OAuthProviderId;
    // 画面に出す名前
    label: string;
    authorizeUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    // 要求するスコープ (メールアドレスと基本プロフィールのみ)
    scope: string;
}

export const OAUTH_PROVIDERS: Readonly<Record<OAuthProviderId, OAuthProviderDefinition>> = Object.freeze({
    google: {
        id: 'google',
        label: 'Google',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile',
    },
    github: {
        id: 'github',
        label: 'GitHub',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scope: 'read:user user:email',
    },
});

export const isOAuthProviderId = (value: unknown): value is OAuthProviderId =>
    typeof value === 'string' && (OAUTH_PROVIDER_IDS as readonly string[]).includes(value);

/**
 * 認可エンドポイントへのリダイレクト URL を組み立てる
 * @param provider: OAuthProviderId
 * @param clientId: string
 * @param redirectUri: string
 * @param state: string CSRF 対策の署名付き state
 * @return string
 */
export const buildAuthorizeUrl = (
    provider: OAuthProviderId,
    clientId: string,
    redirectUri: string,
    state: string,
): string => {
    const definition = OAUTH_PROVIDERS[provider];
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: definition.scope,
        state,
    });
    // Google は refresh token を要らないので同意画面の再表示も求めない
    if (provider === 'google') params.set('prompt', 'select_account');
    return `${definition.authorizeUrl}?${params.toString()}`;
};

/**
 * state の中身。リダイレクト先の検証と有効期限のために署名する
 */
export interface OAuthState {
    provider: OAuthProviderId;
    // ランダム値 (推測防止)
    nonce: string;
    // 有効期限 (UnixtimeMS)
    exp: number;
}

/**
 * 署名付き state を作る
 * @param provider: OAuthProviderId
 * @param secret: string 署名鍵
 * @param ttlMs: number 有効期間
 * @return string
 */
export const createOAuthState = (provider: OAuthProviderId, secret: string, ttlMs: number): string => {
    const payload: OAuthState = { provider, nonce: randomBytes(16).toString('base64url'), exp: Date.now() + ttlMs };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${signature}`;
};

/**
 * state を検証する。署名不一致・期限切れ・プロバイダ不一致はすべて null
 * @param state: string | undefined
 * @param provider: OAuthProviderId コールバックを受けたプロバイダ
 * @param secret: string 署名鍵
 * @param now?: number
 * @return OAuthState | null
 */
export const verifyOAuthState = (
    state: string | undefined | null,
    provider: OAuthProviderId,
    secret: string,
    now: number = Date.now(),
): OAuthState | null => {
    if (typeof state !== 'string' || state === '') return null;
    const separator = state.lastIndexOf('.');
    if (separator <= 0) return null;

    const body = state.slice(0, separator);
    const signature = state.slice(separator + 1);
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    if (signature.length !== expected.length) return null;
    if (timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) === false) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
        if (payload?.provider !== provider) return null;
        if (typeof payload?.exp !== 'number' || payload.exp <= now) return null;
        return payload;
    } catch (err) {
        return null;
    }
};

/**
 * プロバイダの応答からユーザー識別情報を取り出す。
 * Google (OpenID Connect) と GitHub でフィールド名が違うためここで吸収する
 * @param provider: OAuthProviderId
 * @param profile: unknown userInfo エンドポイントの応答
 * @param emails?: unknown GitHub の /user/emails 応答 (プロフィールに email が無い場合の補完)
 * @return { providerUserId, email, name } | null
 */
export const extractProfile = (
    provider: OAuthProviderId,
    profile: any,
    emails?: any,
): { providerUserId: string; email: string | null; name: string } | null => {
    if (typeof profile !== 'object' || profile === null) return null;

    if (provider === 'google') {
        const sub = profile.sub;
        if (typeof sub !== 'string' || sub === '') return null;
        const email = typeof profile.email === 'string' ? profile.email : null;
        const name =
            (typeof profile.name === 'string' && profile.name !== '' ? profile.name : null) ?? email ?? `google-${sub}`;
        return { providerUserId: sub, email, name };
    }

    const id = profile.id;
    if (typeof id !== 'number' && typeof id !== 'string') return null;
    // GitHub はメール非公開設定だとプロフィールに載らないため /user/emails の primary を使う
    let email = typeof profile.email === 'string' ? profile.email : null;
    if (email === null && Array.isArray(emails)) {
        const primary = emails.find((x: any) => x?.primary === true && typeof x?.email === 'string');
        email = typeof primary?.email === 'string' ? primary.email : null;
    }
    const login = typeof profile.login === 'string' && profile.login !== '' ? profile.login : `github-${id}`;
    return { providerUserId: String(id), email, name: login };
};
