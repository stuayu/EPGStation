'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 鍵ファイルの保存先を一時ディレクトリに向ける
// (KEY_FILE_PATH はモジュール読み込み時に確定するため require より前に設定する)
const tmpKeyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'epg-secret-')), 'secret.key');
process.env.EPGSTATION_SECRET_KEY_FILE = tmpKeyFile;

const SecretCrypto = require('../../dist/model/security/SecretCrypto').default;

const newCrypto = (config = {}) => new SecretCrypto({ getConfig: () => config });
const setKey = value => fs.writeFileSync(tmpKeyFile, value);
const rmKey = () => fs.rmSync(tmpKeyFile, { force: true });

test('AES-GCM encrypts, decrypts and masks secrets with the key file', () => {
    setKey('test-key');
    const c = newCrypto();
    const encrypted = c.encrypt('annict-token-1234');
    assert.notEqual(encrypted, 'annict-token-1234');
    assert.equal(c.decrypt(encrypted), 'annict-token-1234');
    assert.equal(c.mask(encrypted), '********1234');
});

// 鍵ファイルが無ければ自動生成され、別インスタンス (別プロセス相当) でも同じ鍵が再利用される
test('a missing key file is auto-generated and reused across instances', () => {
    rmKey();
    const c = newCrypto();
    const encrypted = c.encrypt('auto-key-secret');
    assert.match(encrypted, /^enc:v2:/);
    assert.equal(fs.existsSync(tmpKeyFile), true);
    assert.equal(fs.readFileSync(tmpKeyFile, 'utf8').trim().length > 0, true);

    const c2 = newCrypto();
    assert.equal(c2.decrypt(encrypted), 'auto-key-secret');
});

// 旧 config.yml の secretKey は、鍵ファイルが無い場合に限り鍵ファイルへ移行される
test('a legacy config secretKey is migrated into the key file when the file is missing', () => {
    rmKey();
    const c = newCrypto({ secretKey: 'legacy-key' });
    assert.equal(fs.readFileSync(tmpKeyFile, 'utf8').trim(), 'legacy-key');

    // 移行後は config なしでも同じ鍵が使われる
    const encrypted = c.encrypt('value');
    assert.equal(newCrypto().decrypt(encrypted), 'value');
});

// 既存の鍵ファイルがある場合、旧 config.yml の secretKey は無視される
test('an existing key file takes precedence over a legacy config secretKey', () => {
    setKey('file-key');
    const withLegacy = newCrypto({ secretKey: 'other-key' });
    const encrypted = withLegacy.encrypt('value');
    assert.equal(fs.readFileSync(tmpKeyFile, 'utf8').trim(), 'file-key');
    assert.equal(newCrypto().decrypt(encrypted), 'value');
});

// 鍵導出 v1 (sha256, ソルト無し) → v2 (scrypt, ソルト付き) への移行
test('encrypt() always produces the new v2 format', () => {
    setKey('test-key');
    const c = newCrypto();
    assert.match(c.encrypt('value'), /^enc:v2:/);
});

test('v1-format ciphertext (produced by the old sha256-derived key) is still decryptable', () => {
    const secret = 'test-key';
    const plain = 'legacy-secret-value';
    setKey(secret);
    // v1 の鍵導出 (sha256(secret), ソルト無し) を再現して暗号文を組み立てる
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const v1 = `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;

    const c = newCrypto();
    assert.equal(c.isEncrypted(v1), true);
    assert.equal(c.decrypt(v1), plain);
    assert.equal(c.mask(v1), '********alue');
});

test('isEncrypted() recognizes both v1 and v2 prefixes and rejects plaintext', () => {
    setKey('test-key');
    const c = newCrypto();
    assert.equal(c.isEncrypted('enc:v1:a:b:c'), true);
    assert.equal(c.isEncrypted('enc:v2:a:b:c:d'), true);
    assert.equal(c.isEncrypted('plain-text-token'), false);
});

// 鍵ファイルのローテーション (内容変更) 後は旧鍵の暗号文は復号できない
test('decrypting with a rotated (different) key file fails', () => {
    setKey('original-key');
    const c = newCrypto();
    const encrypted = c.encrypt('value');
    setKey('different-key');
    const rotated = newCrypto();
    assert.throws(() => rotated.decrypt(encrypted));
});

// 鍵ファイルが利用不能 (読み書きできない) な場合は未設定扱いでエラーになる
test('an unusable key file path rejects encryption', () => {
    rmKey();
    fs.mkdirSync(tmpKeyFile); // パスをディレクトリにして読み書き不能にする
    try {
        const c = newCrypto();
        assert.throws(() => c.encrypt('x'), /SecretKeyIsNotConfigured/);
    } finally {
        fs.rmdirSync(tmpKeyFile);
        setKey('test-key');
    }
});
