'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 鍵ファイルの保存先を一時ディレクトリに向け、テスト用の鍵を配置する
// (KEY_FILE_PATH はモジュール読み込み時に確定するため require より前に設定する)
const tmpKeyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'epg-appsetting-')), 'secret.key');
process.env.EPGSTATION_SECRET_KEY_FILE = tmpKeyFile;
fs.writeFileSync(tmpKeyFile, 'test-key');

const AppSettingApiModel = require('../../dist/model/api/config/AppSettingApiModel').default;
const SecretCrypto = require('../../dist/model/security/SecretCrypto').default;

const configuration = { getConfig: () => ({ featureFlags: { systemSettings: true } }) };

function makeHistoryDB() {
    const rows = [];
    let nextId = 1;
    return {
        rows,
        add: async (key, previousValue, now) => {
            rows.push({ id: nextId++, key, previousValue: JSON.stringify(previousValue ?? null), updatedAt: now });
        },
        findLatest: async key => rows.filter(r => r.key === key).slice(-1)[0] ?? null,
        popLatest: async key => {
            const idx = rows.map((r, i) => ({ r, i })).filter(x => x.r.key === key).slice(-1)[0];
            if (!idx) return null;
            rows.splice(idx.i, 1);
            return idx.r;
        },
        list: async key => rows.filter(r => r.key === key).slice().reverse(),
    };
}

function makeIpc() {
    const notified = [];
    return { notified, appSetting: { notifyChanged: keys => notified.push(keys) } };
}

function makeDB(initial = {}) {
    let stored = initial;
    return {
        getAll: async () => stored,
        upsert: async values => {
            stored = { ...stored, ...values };
        },
        get stored() {
            return stored;
        },
    };
}

test('system settings encrypt secrets, mask responses, and preserve masked updates', async () => {
    const db = makeDB();
    const crypto = new SecretCrypto(configuration);
    const model = new AppSettingApiModel(configuration, db, crypto, makeHistoryDB(), makeIpc());
    const first = await model.update({ metadata: { annict: { token: 'token-1234' } } });
    assert.match(db.stored.metadata.annict.token, /^enc:v2:/);
    assert.equal(first.settings.metadata.annict.token, '********1234');
    assert.equal(first.requiresRestart, false);
    const encrypted = db.stored.metadata.annict.token;
    await model.update({ metadata: { annict: { token: '********1234' } } });
    assert.equal(db.stored.metadata.annict.token, encrypted);
    assert.equal((await model.get()).metadata.annict.token, '********1234');
});

test('system settings rejects access while feature is disabled', async () => {
    const model = new AppSettingApiModel(
        { getConfig: () => ({ featureFlags: { systemSettings: false } }) },
        { getAll: async () => ({}) },
        new SecretCrypto({ getConfig: () => ({}) }),
        makeHistoryDB(),
        makeIpc(),
    );
    await assert.rejects(() => model.get(), /SystemSettingsFeatureIsDisabled/);
});

// マスク値の誤認: 新規追加時 (current が文字列でない) にマスク文字列が来た場合、
// それを本物のシークレットとして保存してはならず、エラーにする
test('a masked value with no corresponding existing secret is rejected, not stored as-is', async () => {
    const db = makeDB();
    const crypto = new SecretCrypto(configuration);
    const model = new AppSettingApiModel(configuration, db, crypto, makeHistoryDB(), makeIpc());
    await assert.rejects(
        () => model.update({ metadata: { annict: { token: '********abcd' } } }),
        /masked value has no corresponding existing secret/,
    );
});

// 【重大】マスク値の復元は配列インデックスではなく安定した識別子 (name) で突き合わせる。
// 並べ替え・中間削除・先頭挿入をしてもシークレットが別ターゲットに付け替わらないこと
test('secret restoration by array reordering does not swap secrets between targets', async () => {
    const db = makeDB();
    const crypto = new SecretCrypto(configuration);
    const model = new AppSettingApiModel(configuration, db, crypto, makeHistoryDB(), makeIpc());

    await model.update({
        notifications: {
            targets: [
                { name: 'A', type: 'webhook', url: 'https://a.example.com/hook', secret: 'secret-A' },
                { name: 'B', type: 'webhook', url: 'https://b.example.com/hook', secret: 'secret-B' },
                { name: 'C', type: 'webhook', url: 'https://c.example.com/hook', secret: 'secret-C' },
            ],
        },
    });
    const byName = arr => Object.fromEntries(arr.map(x => [x.name, x]));
    const stored1 = byName(db.stored.notifications.targets);

    // 並べ替え + 先頭挿入 + 中間削除 (B を消す) しつつマスク値のまま PUT する
    const masked = (await model.get()).notifications.targets;
    const maskedByName = byName(masked);
    await model.update({
        notifications: {
            targets: [
                { name: 'D', type: 'webhook', url: 'https://d.example.com/hook', secret: 'secret-D' }, // 新規 (先頭挿入)
                { name: 'C', type: 'webhook', url: maskedByName.C.url, secret: maskedByName.C.secret },
                { name: 'A', type: 'webhook', url: maskedByName.A.url, secret: maskedByName.A.secret },
                // B は中間削除
            ],
        },
    });

    const stored2 = byName(db.stored.notifications.targets);
    assert.equal(stored2.A.secret, stored1.A.secret, 'A の secret は不変であるべき');
    assert.equal(stored2.A.url, stored1.A.url, 'A の url は不変であるべき');
    assert.equal(stored2.C.secret, stored1.C.secret, 'C の secret は不変であるべき');
    assert.equal(stored2.C.url, stored1.C.url, 'C の url は不変であるべき');
    assert.notEqual(stored2.D.secret, stored2.A.secret);
    assert.notEqual(stored2.D.secret, stored2.C.secret);

    const decrypt = v => crypto.decrypt(v);
    assert.equal(decrypt(stored2.A.secret), 'secret-A');
    assert.equal(decrypt(stored2.C.secret), 'secret-C');
    assert.equal(decrypt(stored2.D.secret), 'secret-D');
});

// Discord Webhook URL 等も秘密情報として暗号化・マスク対象に含める (notifications.targets.url)
test('notification target url is encrypted and masked like other secrets', async () => {
    const db = makeDB();
    const crypto = new SecretCrypto(configuration);
    const model = new AppSettingApiModel(configuration, db, crypto, makeHistoryDB(), makeIpc());
    await model.update({
        notifications: { targets: [{ name: 'discord', type: 'discord', url: 'https://discord.com/api/webhooks/x/y' }] },
    });
    assert.match(db.stored.notifications.targets[0].url, /^enc:v2:/);
    const masked = await model.get();
    assert.match(masked.notifications.targets[0].url, /^\*{8}/);
    assert.equal(crypto.decrypt(db.stored.notifications.targets[0].url), 'https://discord.com/api/webhooks/x/y');
});

// 復号失敗時のフォールバック: secretKey 未設定・鍵ローテーション後でも GET は 500 にならず、
// 復号できない項目だけをプレースホルダに差し替えて返す
test('get() falls back to a placeholder for secrets that cannot be decrypted, instead of throwing', async () => {
    const crypto = new SecretCrypto(configuration);
    const db = makeDB();
    const model = new AppSettingApiModel(configuration, db, crypto, makeHistoryDB(), makeIpc());
    await model.update({ metadata: { annict: { token: 'token-1234' } } });

    // 鍵ファイルが変わった (ローテーション) 状態を模したモデルで GET する
    fs.writeFileSync(tmpKeyFile, 'different-key');
    const rotatedCrypto = new SecretCrypto({ getConfig: () => ({}) });
    fs.writeFileSync(tmpKeyFile, 'test-key');
    const rotatedModel = new AppSettingApiModel(configuration, db, rotatedCrypto, makeHistoryDB(), makeIpc());
    const result = await rotatedModel.get();
    assert.equal(result.metadata.annict.token, '********(復号不可)');
});

// 鍵ファイルが利用できない場合の更新エラーは 500 でなく判別可能なメッセージにする
test('update() throws a distinguishable error when the key file is unusable', async () => {
    const db = makeDB();
    // 鍵ファイルのパスをディレクトリにして読み書き不能な状態を模す
    fs.rmSync(tmpKeyFile, { force: true });
    fs.mkdirSync(tmpKeyFile);
    const crypto = new SecretCrypto({ getConfig: () => ({ featureFlags: { systemSettings: true } }) });
    fs.rmdirSync(tmpKeyFile);
    fs.writeFileSync(tmpKeyFile, 'test-key');
    const model = new AppSettingApiModel(
        { getConfig: () => ({ featureFlags: { systemSettings: true } }) },
        db,
        crypto,
        makeHistoryDB(),
        makeIpc(),
    );
    await assert.rejects(
        () => model.update({ metadata: { annict: { token: 'token-1234' } } }),
        /AppSettingSecretKeyIsNotConfigured/,
    );
});

// 変更履歴とロールバック
test('rollback restores the previous value recorded in history', async () => {
    const db = makeDB({ series: { matchThreshold: 0.8 } });
    const crypto = new SecretCrypto(configuration);
    const history = makeHistoryDB();
    const model = new AppSettingApiModel(configuration, db, crypto, history, makeIpc());
    await model.update({ series: { matchThreshold: 0.9 } });
    assert.equal(db.stored.series.matchThreshold, 0.9);
    const historyList = await model.getHistory('series');
    assert.equal(historyList.length, 1);
    const rolledBack = await model.rollback('series');
    assert.equal(db.stored.series.matchThreshold, 0.8);
    assert.equal(rolledBack.settings.series.matchThreshold, 0.8);
});

// 鍵導出 v1→v2 移行: マスク値のまま PUT された既存の v1 暗号文は、次回更新時に v2 で再暗号化される
test('a masked update migrates an existing v1-encrypted secret to v2', async () => {
    const crypto = new SecretCrypto(configuration);
    // v1 形式の暗号文を直接 stored に仕込む (過去に v1 で保存されたデータを模す)
    const v1CipherOf = plain => {
        const nodeCrypto = require('node:crypto');
        const key = nodeCrypto.createHash('sha256').update('test-key').digest();
        const iv = nodeCrypto.randomBytes(12);
        const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
    };
    const v1 = v1CipherOf('legacy-token-1234');
    const db = makeDB({ metadata: { annict: { token: v1 } } });
    const model = new AppSettingApiModel(configuration, db, crypto, makeHistoryDB(), makeIpc());

    const masked = await model.get();
    assert.equal(masked.metadata.annict.token, '********1234');

    await model.update({ metadata: { annict: { token: masked.metadata.annict.token } } });
    assert.match(db.stored.metadata.annict.token, /^enc:v2:/);
    assert.equal(crypto.decrypt(db.stored.metadata.annict.token), 'legacy-token-1234');
});

// requiresRestart: 変更されたキーが再起動を要するかをレスポンスに含める。
// メタデータ/通知プロバイダはいずれも DB 設定を毎回読み直す実装のため、現行スキーマでは
// 両方とも requiresRestart: false が正しい (AppSettingSchema.ts の宣言に追随する)
test('update() reports requiresRestart based on the AppSettingSchema declarations', async () => {
    const db = makeDB();
    const crypto = new SecretCrypto(configuration);
    const model = new AppSettingApiModel(configuration, db, crypto, makeHistoryDB(), makeIpc());
    const result = await model.update({ metadata: { annict: { enabled: true } } });
    assert.equal(result.requiresRestart, false);
    assert.deepEqual(result.requiresRestartKeys, []);

    const result2 = await model.update({ notifications: { enabled: true, targets: [] } });
    assert.equal(result2.requiresRestart, false);
});
