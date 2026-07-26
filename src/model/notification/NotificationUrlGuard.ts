import { promises as dns } from 'dns';
import * as net from 'net';

/**
 * 通知先 URL の SSRF 対策 (§S3-6)。
 * - スキームを http/https に限定する
 * - allowPrivate が false の場合、ループバック・リンクローカル・プライベート IP 帯を宛先とする
 *   リクエストを拒否する (ホスト名は DNS 解決した実 IP でチェックする)
 * 完全な DNS リバインディング対策 (TOCTOU) ではないが、テスト通知 API 経由の
 * ブラインド SSRF (社内メタデータサーバ等への任意 POST) を最小限のコストで防ぐ
 */
export async function assertNotificationUrlIsAllowed(rawUrl: string, allowPrivate: boolean): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('NotificationUrlIsInvalid');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('NotificationUrlSchemeNotAllowed');
    }
    if (allowPrivate) return;

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (hostname.toLowerCase() === 'localhost') {
        throw new Error('NotificationUrlTargetsPrivateNetwork');
    }

    const ipVersion = net.isIP(hostname);
    if (ipVersion !== 0) {
        if (isPrivateAddress(hostname, ipVersion)) throw new Error('NotificationUrlTargetsPrivateNetwork');
        return;
    }

    // ホスト名は DNS 解決した実 IP で判定する
    let records: { address: string; family: number }[];
    try {
        records = await dns.lookup(hostname, { all: true });
    } catch {
        throw new Error('NotificationUrlCouldNotBeResolved');
    }
    for (const r of records) {
        if (isPrivateAddress(r.address, r.family)) throw new Error('NotificationUrlTargetsPrivateNetwork');
    }
}

function isPrivateAddress(address: string, family: number): boolean {
    return family === 4 ? isPrivateV4(address) : isPrivateV6(address);
}

function isPrivateV4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true; // 不正な形式は安全側でブロック
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local (メタデータサーバ 169.254.169.254 を含む)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
}

function isPrivateV6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
    if (lower.startsWith('::ffff:')) return isPrivateV4(lower.slice('::ffff:'.length));
    return false;
}
