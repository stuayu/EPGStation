'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const SecretCrypto = require('../../dist/model/security/SecretCrypto').default;

test('AES-GCM encrypts, decrypts and masks secrets', () => {
    const c = new SecretCrypto({ getConfig: () => ({ secretKey: 'test-key' }) });
    const encrypted = c.encrypt('annict-token-1234');
    assert.notEqual(encrypted, 'annict-token-1234');
    assert.equal(c.decrypt(encrypted), 'annict-token-1234');
    assert.equal(c.mask(encrypted), '********1234');
});

test('missing key rejects encryption', () => {
    const c = new SecretCrypto({ getConfig: () => ({}) });
    assert.throws(() => c.encrypt('x'), /SecretKeyIsNotConfigured/);
});

// 鍵導出 v1 (sha256, ソルト無し) → v2 (scrypt, ソルト付き) への移行
test('encrypt() always produces the new v2 format', () => {
    const c = new SecretCrypto({ getConfig: () => ({ secretKey: 'test-key' }) });
    assert.match(c.encrypt('value'), /^enc:v2:/);
});

test('v1-format ciphertext (produced by the old sha256-derived key) is still decryptable', () => {
    const secret = 'test-key';
    const plain = 'legacy-secret-value';
    // v1 の鍵導出 (sha256(secret), ソルト無し) を再現して暗号文を組み立てる
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const v1 = `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;

    const c = new SecretCrypto({ getConfig: () => ({ secretKey: secret }) });
    assert.equal(c.isEncrypted(v1), true);
    assert.equal(c.decrypt(v1), plain);
    assert.equal(c.mask(v1), '********alue');
});

test('isEncrypted() recognizes both v1 and v2 prefixes and rejects plaintext', () => {
    const c = new SecretCrypto({ getConfig: () => ({ secretKey: 'test-key' }) });
    assert.equal(c.isEncrypted('enc:v1:a:b:c'), true);
    assert.equal(c.isEncrypted('enc:v2:a:b:c:d'), true);
    assert.equal(c.isEncrypted('plain-text-token'), false);
});

test('decrypting with a rotated (different) secretKey fails', () => {
    const c = new SecretCrypto({ getConfig: () => ({ secretKey: 'original-key' }) });
    const encrypted = c.encrypt('value');
    const rotated = new SecretCrypto({ getConfig: () => ({ secretKey: 'different-key' }) });
    assert.throws(() => rotated.decrypt(encrypted));
});
