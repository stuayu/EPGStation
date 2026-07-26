import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { inject, injectable } from 'inversify';
import IConfiguration from '../IConfiguration';
import ISecretCrypto from './ISecretCrypto';

@injectable()
export default class SecretCrypto implements ISecretCrypto {
    private readonly key: Buffer | null;
    constructor(@inject('IConfiguration') configuration: IConfiguration) {
        const secret = configuration.getConfig().secretKey;
        this.key =
            typeof secret === 'string' && secret.length > 0 ? createHash('sha256').update(secret).digest() : null;
    }
    public isEncrypted(value: string): boolean {
        return value.startsWith('enc:v1:');
    }
    public encrypt(value: string): string {
        if (this.key === null) throw new Error('SecretKeyIsNotConfigured');
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
    }
    public decrypt(value: string): string {
        if (!this.isEncrypted(value)) return value;
        if (this.key === null) throw new Error('SecretKeyIsNotConfigured');
        const [, version, iv, tag, data] = value.split(':');
        if (version !== 'v1' || !iv || !tag || !data) throw new Error('EncryptedSecretIsInvalid');
        const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    }
    public mask(value: string): string {
        const plain = this.decrypt(value);
        return plain.length === 0 ? '' : `********${plain.slice(-4)}`;
    }
}
