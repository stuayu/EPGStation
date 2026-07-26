import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { inject, injectable } from 'inversify';
import IConfiguration from '../IConfiguration';
import ISecretCrypto from './ISecretCrypto';

/**
 * 設定画面の秘密情報 (トークン・Webhook URL 等) を暗号化して DB に保存するためのユーティリティ。
 * フォーマットは `enc:v2:salt:iv:tag:data` (すべて base64)。
 * 鍵導出は scrypt (ソルト付き) を使用する。
 * v1 (`enc:v1:iv:tag:data`, sha256(secretKey) 1 回・ソルトなし) の暗号文も復号可能に保ち、
 * secretKey ローテーション時以外は既存データを読めなくならないようにする (§6.6)。
 * v1 で書かれた既存の暗号文は次回 update() 時に v2 で再暗号化される (自動移行)
 */
@injectable()
export default class SecretCrypto implements ISecretCrypto {
    private static readonly SCRYPT_KEY_LENGTH = 32;

    private readonly secret: string | null;
    private readonly keyV1: Buffer | null;

    constructor(@inject('IConfiguration') configuration: IConfiguration) {
        const secret = configuration.getConfig().secretKey;
        this.secret = typeof secret === 'string' && secret.length > 0 ? secret : null;
        this.keyV1 = this.secret !== null ? this.deriveKeyV1(this.secret) : null;
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
