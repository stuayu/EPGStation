import { createHmac, timingSafeEqual } from 'crypto';

/**
 * セッショントークンの生成と検証。
 * サーバー側にセッションストアを持たず、HMAC 署名付きの自己完結トークンにする
 * (再起動でログアウトさせないため / 複数プロセス構成でも共有不要なため)。
 *
 * 形式: '<base64url(payload JSON)>.<base64url(HMAC-SHA256)>'
 * payload には失効に必要な情報だけを入れる (パスワードやハッシュは絶対に入れない)
 */

export interface SessionPayload {
    // ユーザー ID
    uid: number;
    // ユーザー名 (表示用)
    name: string;
    // 'admin' | 'user'。検証時に DB の現在値で上書きされる (権限変更を再ログインなしで反映するため)
    role: string;
    // 有効期限 (UnixtimeMS)
    exp: number;
    // 発行時点の User.tokenVersion。パスワード変更で加算され、既存トークンが失効する
    ver: number;
}

const encode = (value: Buffer): string => value.toString('base64url');

const sign = (payload: string, secret: string): string => encode(createHmac('sha256', secret).update(payload).digest());

/**
 * セッショントークンを発行する
 * @param payload: SessionPayload
 * @param secret: string 署名鍵
 * @return string
 */
export const createSessionToken = (payload: SessionPayload, secret: string): string => {
    const body = encode(Buffer.from(JSON.stringify(payload), 'utf8'));
    return `${body}.${sign(body, secret)}`;
};

/**
 * セッショントークンを検証して中身を返す。
 * 署名不一致・期限切れ・壊れた値はすべて null (理由は呼び出し側に伝えない = 攻撃者への情報を減らす)
 * @param token: string | undefined
 * @param secret: string 署名鍵
 * @param now?: number 現在時刻 (テスト用)
 * @return SessionPayload | null
 */
export const verifySessionToken = (
    token: string | undefined | null,
    secret: string,
    now: number = Date.now(),
): SessionPayload | null => {
    if (typeof token !== 'string' || token === '') return null;
    const separator = token.lastIndexOf('.');
    if (separator <= 0) return null;

    const body = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = sign(body, secret);
    // 長さが違うと timingSafeEqual が例外を投げるため先に弾く
    if (signature.length !== expected.length) return null;
    if (timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) === false) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (typeof payload?.uid !== 'number' || typeof payload?.exp !== 'number') return null;
        if (typeof payload?.ver !== 'number' || typeof payload?.name !== 'string') return null;
        if (typeof payload?.role !== 'string') return null;
        if (payload.exp <= now) return null;
        return payload as SessionPayload;
    } catch (err) {
        return null;
    }
};

/**
 * Cookie ヘッダから指定した名前の値を取り出す (cookie-parser を足さずに済ませる)
 * @param header: string | undefined Cookie ヘッダ
 * @param name: string
 * @return string | null
 */
export const readCookie = (header: string | undefined, name: string): string | null => {
    if (typeof header !== 'string' || header === '') return null;
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        if (part.slice(0, index).trim() !== name) continue;
        try {
            return decodeURIComponent(part.slice(index + 1).trim());
        } catch (err) {
            return null;
        }
    }
    return null;
};
