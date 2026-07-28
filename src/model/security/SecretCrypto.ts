import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import IConfiguration from '../IConfiguration';
import ISecretCrypto from './ISecretCrypto';

/**
 * 設定画面の秘密情報 (トークン・Webhook URL 等) を暗号化して DB に保存するためのユーティリティ。
 * フォーマットは `enc:v2:salt:iv:tag:data` (すべて base64)。
 * 鍵導出は scrypt (ソルト付き) を使用する。
 * v1 (`enc:v1:iv:tag:data`, sha256(secretKey) 1 回・ソルトなし) の暗号文も復号可能に保ち、
 * secretKey ローテーション時以外は既存データを読めなくならないようにする (§6.6)。
 * v1 で書かれた既存の暗号文は次回 update() 時に v2 で再暗号化される (自動移行)
 *
 * 暗号化鍵は data/key/secret.key に集約される (config.yml の secretKey は廃止)。
 * 鍵ファイルが存在しなければ初回起動時にランダムな鍵を自動生成して保存する。
 * 旧バージョンの config.yml に secretKey が残っている場合は、鍵ファイルが無いときに限り
 * その値で鍵ファイルを作成して移行する (既存の暗号化済みデータを読めなくならないようにするため)。
 * (ファイルパスは環境変数 EPGSTATION_SECRET_KEY_FILE で上書き可能)
 */
@injectable()
export default class SecretCrypto implements ISecretCrypto {
    private static readonly SCRYPT_KEY_LENGTH = 32;

    // 自動生成された鍵の保存先 (環境変数で上書き可能)
    private static readonly KEY_FILE_PATH =
        typeof process.env.EPGSTATION_SECRET_KEY_FILE === 'string' && process.env.EPGSTATION_SECRET_KEY_FILE.length > 0
            ? process.env.EPGSTATION_SECRET_KEY_FILE
            : path.join(__dirname, '..', '..', '..', 'data', 'key', 'secret.key');

    private readonly secret: string | null;
    private readonly keyV1: Buffer | null;

    constructor(@inject('IConfiguration') configuration: IConfiguration) {
        // 旧 config.yml の secretKey (廃止済み)。鍵ファイルが無い場合のみ移行の種として使う
        const legacySecret = (configuration.getConfig() as { secretKey?: string }).secretKey;
        this.secret = SecretCrypto.loadOrCreateKeyFile(
            typeof legacySecret === 'string' && legacySecret.length > 0 ? legacySecret : null,
        );
        this.keyV1 = this.secret !== null ? this.deriveKeyV1(this.secret) : null;
    }

    /**
     * 鍵ファイルを読み込む。存在しなければ鍵を生成して保存する。
     * @param legacySeed 旧 config.yml の secretKey。鍵ファイル新規作成時はこの値を優先して使い、
     *                   既存の暗号化済みデータを引き継ぐ (null ならランダム生成)。
     * Operator / Service / EPGUpdater の複数プロセスが同時に初回起動する可能性があるため、
     * `wx` フラグによる排他作成 + EEXIST 時の再読み込みで競合を回避する。
     */
    private static loadOrCreateKeyFile(legacySeed: string | null): string | null {
        const filePath = SecretCrypto.KEY_FILE_PATH;

        // 既存の鍵ファイルを読み込む
        try {
            const existing = fs.readFileSync(filePath, 'utf8').trim();
            if (existing.length > 0) {
                return existing;
            }
        } catch (err: any) {
            if (err?.code !== 'ENOENT') {
                // 権限不足など、存在しない以外の理由で読めない場合は未設定扱い
                return null;
            }
        }

        // 新規生成
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const newKey = legacySeed !== null ? legacySeed : randomBytes(48).toString('base64url');
            fs.writeFileSync(filePath, newKey, { mode: 0o600, flag: 'wx' });

            return newKey;
        } catch (err: any) {
            if (err?.code === 'EEXIST') {
                // 他プロセスが先に生成した場合は再読み込み
                try {
                    const existing = fs.readFileSync(filePath, 'utf8').trim();

                    return existing.length > 0 ? existing : null;
                } catch {
                    return null;
                }
            }

            return null;
        }
    }

    public isEncrypted(value: string): boolean {
        return value.startsWith('enc:v1:') || value.startsWith('enc:v2:');
    }

    public encrypt(value: string): string {
        if (this.secret === null) throw new Error('SecretKeyIsNotConfigured');
        const salt = randomBytes(16);
        const key = this.deriveKeyV2(this.secret, salt);
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return `enc:v2:${salt.toString('base64')}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
    }

    public decrypt(value: string): string {
        if (!this.isEncrypted(value)) return value;
        if (this.secret === null) throw new Error('SecretKeyIsNotConfigured');
        const parts = value.split(':');
        const version = parts[1];
        if (version === 'v2') {
            const [, , salt, iv, tag, data] = parts;
            if (!salt || !iv || !tag || !data) throw new Error('EncryptedSecretIsInvalid');
            const key = this.deriveKeyV2(this.secret, Buffer.from(salt, 'base64'));
            return this.aesGcmDecrypt(key, iv, tag, data);
        }
        // v1 (旧形式) との後方互換
        const [, , iv, tag, data] = parts;
        if (!iv || !tag || !data || this.keyV1 === null) throw new Error('EncryptedSecretIsInvalid');
        return this.aesGcmDecrypt(this.keyV1, iv, tag, data);
    }

    public getSigningKey(purpose: string): string | null {
        if (this.secret === null) return null;
        // 用途ごとに異なる鍵になるよう purpose を混ぜる (暗号化鍵をそのまま署名に使わない)
        return createHash('sha256').update(`${purpose}:${this.secret}`).digest('base64url');
    }

    public mask(value: string): string {
        const plain = this.decrypt(value);
        return plain.length === 0 ? '' : `********${plain.slice(-4)}`;
    }

    private aesGcmDecrypt(key: Buffer, iv: string, tag: string, data: string): string {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    }

    private deriveKeyV1(secret: string): Buffer {
        return createHash('sha256').update(secret).digest();
    }

    private deriveKeyV2(secret: string, salt: Buffer): Buffer {
        return scryptSync(secret, salt, SecretCrypto.SCRYPT_KEY_LENGTH);
    }
}
