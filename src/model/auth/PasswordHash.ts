import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * パスワードのハッシュ化と照合。
 * 依存を増やさないよう Node 標準の scrypt を使う。
 * 保存形式は 'scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>' で、
 * 将来パラメータやアルゴリズムを変えても既存のハッシュを読み続けられるようにしている
 */

// scrypt のコストパラメータ (N は 2 の冪。16384 で 1 回あたり数十 ms 程度)
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt は N*r*128 バイト以上のメモリを要求するため既定 (32MB) を上回る値を明示する
const MAX_MEMORY = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * パスワードをハッシュ化する
 * @param password: string
 * @return string 保存用の文字列
 */
export const hashPassword = (password: string): string => {
    const salt = randomBytes(SALT_LENGTH);
    const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEMORY });
    return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
};

/**
 * パスワードが保存済みハッシュと一致するか。
 * 比較は timingSafeEqual で行い、経過時間から一致度が漏れないようにする
 * @param password: string
 * @param stored: string hashPassword() が返した文字列
 * @return boolean
 */
export const verifyPassword = (password: string, stored: string): boolean => {
    if (typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (Number.isInteger(n) === false || Number.isInteger(r) === false || Number.isInteger(p) === false) return false;

    try {
        const salt = Buffer.from(parts[4], 'hex');
        const expected = Buffer.from(parts[5], 'hex');
        if (salt.length === 0 || expected.length === 0) return false;
        const actual = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: MAX_MEMORY });
        return timingSafeEqual(actual, expected);
    } catch (err) {
        // 壊れたハッシュ (手で書き換えられた等) は不一致として扱う
        return false;
    }
};

/**
 * パスワードとして受け付けられる文字列かを検証する。問題があればエラーを投げる
 * @param password: unknown
 */
export const assertValidPassword: (password: unknown) => asserts password is string = password => {
    if (typeof password !== 'string') throw new Error('InvalidPassword');
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error('PasswordIsTooShort');
    if (password.length > MAX_PASSWORD_LENGTH) throw new Error('PasswordIsTooLong');
};
