import { Response } from 'express';

/**
 * セッション Cookie の名前と発行 / 破棄。
 * <video> や <img> からのリクエストにも自動で付くよう、ヘッダではなく Cookie を使う。
 * JavaScript から読めないよう HttpOnly、外部サイトからの送信を防ぐため SameSite=Lax を付ける
 */
export const SESSION_COOKIE_NAME = 'epgstation_session';

/**
 * セッション Cookie を発行する
 * @param res: Response
 * @param token: string
 * @param maxAgeSec: number
 * @param path: string Cookie のパス (subDirectory 運用に合わせる)
 */
export const setSessionCookie = (res: Response, token: string, maxAgeSec: number, path: string = '/'): void => {
    // https 経由のアクセスなら Secure を付ける (http でも使える構成があるため固定はしない)
    const secure = res.req?.secure === true || res.req?.headers['x-forwarded-proto'] === 'https';
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        `Path=${path}`,
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAgeSec}`,
    ];
    if (secure === true) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
};

/**
 * セッション Cookie を破棄する
 * @param res: Response
 * @param path: string
 */
export const clearSessionCookie = (res: Response, path: string = '/'): void => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0`);
};
