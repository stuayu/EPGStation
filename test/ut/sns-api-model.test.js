'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SnsApiModel = require('../../dist/model/api/sns/SnsApiModel').default;
const { BlueskyApiError } = require('../../dist/model/sns/IBlueskyClient');
const { MisskeyApiError } = require('../../dist/model/sns/IMisskeyClient');

// ------------------------------------------------------------------
// スタブ群
// ------------------------------------------------------------------

// ISnsAccountDB のインメモリ実装
function makeSnsAccountDB() {
    const rows = new Map();
    let nextId = 1;
    return {
        rows,
        async insertOnce(account) {
            const id = nextId++;
            account.id = id;
            rows.set(id, { ...account });
            return id;
        },
        async update(account) {
            rows.set(account.id, { ...account });
        },
        async delete(id) {
            rows.delete(id);
        },
        async findById(id) {
            return rows.get(id) ?? null;
        },
        async findByUser(userId) {
            return [...rows.values()].filter(r => r.userId === userId);
        },
        async findDuplicate(provider, userId, remoteUserId, instanceUrl) {
            for (const r of rows.values()) {
                if (
                    r.provider === provider &&
                    r.userId === userId &&
                    r.remoteUserId === remoteUserId &&
                    r.instanceUrl === instanceUrl
                ) {
                    return r;
                }
            }
            return null;
        },
        // テスト用: DB へ直接行を差し込む
        seed(row) {
            const id = nextId++;
            const saved = { id, ...row };
            rows.set(id, saved);
            return saved;
        },
    };
}

// ISecretCrypto のスタブ。'ENC:' プレフィックスの有無で暗号化済みかを判定する
const makeCrypto = () => ({
    getSigningKey: () => null,
    encrypt: value => `ENC:${value}`,
    decrypt: value => (value.startsWith('ENC:') ? value.slice(4) : value),
    isEncrypted: value => value.startsWith('ENC:'),
    mask: value => value,
});

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} };
const makeLoggerModel = () => ({
    initialize: () => {},
    getLogger: () => ({ system: noopLog, access: noopLog, stream: noopLog, encode: noopLog }),
});

const makeModel = ({ blueskyClient = {}, misskeyClient = {}, misskeyAuthModel = {}, snsAccountDB, crypto } = {}) => {
    const db = snsAccountDB ?? makeSnsAccountDB();
    return {
        db,
        model: new SnsApiModel(
            makeLoggerModel(),
            db,
            crypto ?? makeCrypto(),
            blueskyClient,
            misskeyClient,
            misskeyAuthModel,
        ),
    };
};

// ------------------------------------------------------------------
// getAccounts / updateAccount / deleteAccount
// ------------------------------------------------------------------

test('getAccounts() はログインユーザーの行だけを SnsAccountItem へ変換して返す (credential は含めない)', async () => {
    const { db, model } = makeModel();
    db.seed({
        provider: 'bluesky',
        userId: 10,
        remoteUserId: 'did:1',
        instanceUrl: 'bsky.social',
        handle: 'foo',
        displayName: 'Foo',
        avatarUrl: null,
        credential: 'ENC:{}',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });
    db.seed({ provider: 'bluesky', userId: 999, remoteUserId: 'did:2', instanceUrl: 'bsky.social', handle: 'x', displayName: 'X', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });

    const result = await model.getAccounts(10);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].handle, 'foo');
    assert.equal(result.items[0].needsReauth, false);
    assert.equal('credential' in result.items[0], false);
});

test('getAccounts() は credential が未暗号化 (isEncrypted=false) なら needsReauth を true にする (理由は encryption)', async () => {
    const { db, model } = makeModel();
    db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h', displayName: 'H', avatarUrl: null, credential: 'plain-not-encrypted', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, grantedPermissions: JSON.stringify(['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions']), createdAt: 1, updatedAt: 1 });
    const result = await model.getAccounts(1);
    assert.equal(result.items[0].needsReauth, true);
    assert.equal(result.items[0].needsReauthReason, 'encryption');
});

// MiAuth は permission がトークン発行時に固定されるため、後から要求権限を増やしても
// 既存トークンには反映されない。連携時点で記録した grantedPermissions と現在の要求権限を
// 比較して、不足があれば再連携を促す (理由は permission)
test('getAccounts() は misskey アカウントの grantedPermissions が現在の要求権限を満たさなければ needsReauth を true にする (理由は permission)', async () => {
    const misskeyAuthModel = {
        getRequiredPermissions: () => ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions'],
    };
    const { db, model } = makeModel({ misskeyAuthModel });
    // write:reactions が追加される前に連携されたアカウントを模す
    db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h', displayName: 'H', avatarUrl: null, credential: 'ENC:{"accessToken":"tok"}', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, grantedPermissions: JSON.stringify(['write:notes', 'write:drive', 'read:account', 'read:channels']), createdAt: 1, updatedAt: 1 });

    const result = await model.getAccounts(1);
    assert.equal(result.items[0].needsReauth, true);
    assert.equal(result.items[0].needsReauthReason, 'permission');
});

test('getAccounts() は grantedPermissions カラムが無い (このカラム追加前に連携された) misskey アカウントも再連携対象にする', async () => {
    const misskeyAuthModel = {
        getRequiredPermissions: () => ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions'],
    };
    const { db, model } = makeModel({ misskeyAuthModel });
    db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h', displayName: 'H', avatarUrl: null, credential: 'ENC:{"accessToken":"tok"}', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, grantedPermissions: null, createdAt: 1, updatedAt: 1 });

    const result = await model.getAccounts(1);
    assert.equal(result.items[0].needsReauth, true);
    assert.equal(result.items[0].needsReauthReason, 'permission');
});

test('getAccounts() は要求権限をすべて満たす misskey アカウントは needsReauth を false にする', async () => {
    const misskeyAuthModel = {
        getRequiredPermissions: () => ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions'],
    };
    const { db, model } = makeModel({ misskeyAuthModel });
    db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h', displayName: 'H', avatarUrl: null, credential: 'ENC:{"accessToken":"tok"}', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, grantedPermissions: JSON.stringify(['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions']), createdAt: 1, updatedAt: 1 });

    const result = await model.getAccounts(1);
    assert.equal(result.items[0].needsReauth, false);
    assert.equal(result.items[0].needsReauthReason, null);
});

test('updateAccount() は他人のアカウントを拒否する', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    await assert.rejects(() => model.updateAccount(999, row.id, { isDefaultLocalOnly: true }), /SnsAccountIsNull/);
});

test('updateAccount() は存在しない id を拒否する', async () => {
    const { model } = makeModel();
    await assert.rejects(() => model.updateAccount(1, 12345, {}), /SnsAccountIsNull/);
});

test('updateAccount() は指定されたフィールドだけを更新する', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    await model.updateAccount(1, row.id, { defaultVisibility: 'home', defaultChannelId: 'ch1', defaultChannelName: 'Channel 1' });
    const updated = await db.findById(row.id);
    assert.equal(updated.defaultVisibility, 'home');
    assert.equal(updated.defaultChannelId, 'ch1');
    assert.equal(updated.defaultChannelName, 'Channel 1');
    // isDefaultLocalOnly は指定していないので変わらない
    assert.equal(updated.isDefaultLocalOnly, false);
});

test('deleteAccount() は他人のアカウントを拒否し、DB から消えない', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    await assert.rejects(() => model.deleteAccount(2, row.id), /SnsAccountIsNull/);
    assert.notEqual(await db.findById(row.id), null);
});

test('deleteAccount() は所有者本人なら削除できる', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    await model.deleteAccount(1, row.id);
    assert.equal(await db.findById(row.id), null);
});

// ------------------------------------------------------------------
// loginBluesky
// ------------------------------------------------------------------

test('loginBluesky() は新規アカウントを暗号化した credential 付きで作成する', async () => {
    const blueskyClient = {
        login: async () => ({ did: 'did:1', handle: 'user.bsky.social', accessJwt: 'a', refreshJwt: 'r' }),
        getProfile: async () => ({ did: 'did:1', handle: 'user.bsky.social', displayName: 'User', avatarUrl: 'https://x/a.png' }),
    };
    const { db, model } = makeModel({ blueskyClient });

    const item = await model.loginBluesky(10, { identifier: 'user.bsky.social', appPassword: 'pass' });
    assert.equal(item.provider, 'bluesky');
    assert.equal(item.handle, 'user.bsky.social');
    assert.equal(item.displayName, 'User');
    assert.equal(item.needsReauth, false);

    const stored = await db.findById(item.id);
    assert.equal(stored.credential.startsWith('ENC:'), true);
    const credential = JSON.parse(stored.credential.slice(4));
    assert.equal(credential.appPassword, 'pass');
});

test('loginBluesky() は getProfile() が失敗してもログイン結果 (session) の値にフォールバックする', async () => {
    const blueskyClient = {
        login: async () => ({ did: 'did:1', handle: 'fallback.bsky.social', accessJwt: 'a', refreshJwt: 'r' }),
        getProfile: async () => {
            throw new Error('network error');
        },
    };
    const { model } = makeModel({ blueskyClient });
    const item = await model.loginBluesky(null, { identifier: 'fallback.bsky.social', appPassword: 'pass' });
    assert.equal(item.handle, 'fallback.bsky.social');
    assert.equal(item.displayName, 'fallback.bsky.social');
    assert.equal(item.avatarUrl, null);
});

test('loginBluesky() は同一アカウントの再ログインで新規作成せず既存行を更新する', async () => {
    const blueskyClient = {
        login: async () => ({ did: 'did:1', handle: 'user.bsky.social', accessJwt: 'new-a', refreshJwt: 'new-r' }),
        getProfile: async () => ({ did: 'did:1', handle: 'user.bsky.social', displayName: 'User', avatarUrl: null }),
    };
    const { db, model } = makeModel({ blueskyClient });
    const existing = db.seed({
        provider: 'bluesky',
        userId: 10,
        remoteUserId: 'did:1',
        instanceUrl: 'bsky.social',
        handle: 'user.bsky.social',
        displayName: 'User',
        avatarUrl: null,
        credential: 'ENC:{}',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const item = await model.loginBluesky(10, { identifier: 'user.bsky.social', appPassword: 'pass' });
    assert.equal(item.id, existing.id);
    assert.equal(db.rows.size, 1);
});

test('loginBluesky() のログイン失敗は SnsBlueskyLoginFailed として伝える', async () => {
    const blueskyClient = {
        login: async () => {
            throw new BlueskyApiError(401, 'Invalid identifier or password');
        },
    };
    const { model } = makeModel({ blueskyClient });
    await assert.rejects(
        () => model.loginBluesky(null, { identifier: 'user', appPassword: 'wrong' }),
        /SnsBlueskyLoginFailed/,
    );
});

// ------------------------------------------------------------------
// Misskey MiAuth
// ------------------------------------------------------------------

test('createMisskeyAuthSession() は IMisskeyAuthModel.createSession() へそのまま委譲する', async () => {
    const calls = [];
    const misskeyAuthModel = {
        createSession: (instanceUrl, userId, baseUrl) => {
            calls.push({ instanceUrl, userId, baseUrl });
            return { sessionId: 's1', authUrl: 'https://misskey.io/miauth/s1' };
        },
    };
    const { model } = makeModel({ misskeyAuthModel });
    const result = await model.createMisskeyAuthSession(10, { instanceUrl: 'misskey.io' }, 'http://localhost:8888');
    assert.deepEqual(result, { sessionId: 's1', authUrl: 'https://misskey.io/miauth/s1' });
    assert.deepEqual(calls, [{ instanceUrl: 'misskey.io', userId: 10, baseUrl: 'http://localhost:8888' }]);
});

test('completeMisskeyAuth() は新規アカウントを defaultVisibility=public で作成する', async () => {
    const misskeyAuthModel = {
        completeSession: async () => ({
            host: 'misskey.io',
            token: 'tok',
            remoteUserId: 'u1',
            handle: 'foo',
            displayName: 'Foo',
            avatarUrl: null,
            grantedPermissions: ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions'],
        }),
    };
    const { db, model } = makeModel({ misskeyAuthModel });
    await model.completeMisskeyAuth(10, 'session-1');

    const rows = await db.findByUser(10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'misskey');
    assert.equal(rows[0].defaultVisibility, 'public');
    assert.equal(rows[0].instanceUrl, 'misskey.io');
    // completeSession() が返した grantedPermissions をそのまま保存する (再連携判定に使うため)
    assert.deepEqual(
        JSON.parse(rows[0].grantedPermissions),
        ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions'],
    );
});

test('completeMisskeyAuth() は同一アカウントなら既存行を更新する (defaultVisibility は保持)', async () => {
    const misskeyAuthModel = {
        completeSession: async () => ({
            host: 'misskey.io',
            token: 'new-tok',
            remoteUserId: 'u1',
            handle: 'foo',
            displayName: 'Foo',
            avatarUrl: null,
            grantedPermissions: ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions'],
        }),
    };
    const { db, model } = makeModel({ misskeyAuthModel });
    const existing = db.seed({
        provider: 'misskey',
        userId: 10,
        remoteUserId: 'u1',
        instanceUrl: 'misskey.io',
        handle: 'foo',
        displayName: 'Foo',
        avatarUrl: null,
        credential: 'ENC:{}',
        defaultVisibility: 'home',
        defaultChannelId: 'ch1',
        defaultChannelName: 'Channel',
        isDefaultLocalOnly: true,
        createdAt: 1,
        updatedAt: 1,
    });

    await model.completeMisskeyAuth(10, 'session-1');
    const updated = await db.findById(existing.id);
    assert.equal(updated.defaultVisibility, 'home');
    assert.equal(db.rows.size, 1);
});

test('getMisskeyChannels() は misskey アカウントでなければ拒否する', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    await assert.rejects(() => model.getMisskeyChannels(1, row.id), /SnsAccountIsNull/);
});

test('getMisskeyChannels() は misskeyClient.getChannels() の結果をそのまま返す', async () => {
    const misskeyClient = {
        getChannels: async (host, token) => {
            assert.equal(host, 'misskey.io');
            assert.equal(token, 'tok-1');
            return [{ id: 'c1', name: 'Channel1' }];
        },
    };
    const { db, model } = makeModel({ misskeyClient });
    const row = db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{"accessToken":"tok-1"}', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    const result = await model.getMisskeyChannels(1, row.id);
    assert.deepEqual(result.items, [{ id: 'c1', name: 'Channel1' }]);
});

// ------------------------------------------------------------------
// post()
// ------------------------------------------------------------------

test('post() は accountIds が空なら拒否する', async () => {
    const { model } = makeModel();
    await assert.rejects(() => model.post(1, { accountIds: [], text: 'hi' }), /SnsPostAccountIdsIsEmpty/);
});

test('post() は画像が 4 枚を超えると拒否する', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    const images = Array.from({ length: 5 }, () => ({ dataUrl: 'data:image/png;base64,AAAA' }));
    await assert.rejects(() => model.post(1, { accountIds: [row.id], text: 'hi', images }), /SnsPostTooManyImages/);
});

test('post() は存在しないアカウントを isSuccess:false で返す (他の結果には影響しない)', async () => {
    const { db, model } = makeModel({
        blueskyClient: {
            createPost: async () => ({ uri: 'at://did:1/app.bsky.feed.post/abc', cid: 'c1' }),
        },
    });
    const ok = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{"identifier":"h","appPassword":"p","accessJwt":"a","refreshJwt":"r"}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });

    const result = await model.post(1, { accountIds: [ok.id, 99999], text: 'hi' });
    assert.equal(result.results.length, 2);
    const okResult = result.results.find(r => r.accountId === ok.id);
    const missing = result.results.find(r => r.accountId === 99999);
    assert.equal(okResult.isSuccess, true);
    assert.equal(missing.isSuccess, false);
    assert.equal(missing.detail, 'SnsAccountIsNull');
});

test('post() は他人のアカウント id を指定すると失敗になる (認証有効時のなりすまし対策)', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    const result = await model.post(2, { accountIds: [row.id], text: 'hi' });
    assert.equal(result.results[0].isSuccess, false);
    assert.equal(result.results[0].detail, 'SnsAccountIsNull');
});

test('post() は片方のアカウントへの投稿が失敗しても、もう片方の成功結果は残る', async () => {
    const misskeyClient = {
        uploadFile: async () => {
            throw new Error('should not upload');
        },
        createNote: async () => {
            throw new MisskeyApiError(400, 'RATE_LIMIT_EXCEEDED', 'rate limited');
        },
    };
    const blueskyClient = {
        createPost: async () => ({ uri: 'at://did:1/app.bsky.feed.post/abc', cid: 'c1' }),
    };
    const { db, model } = makeModel({ blueskyClient, misskeyClient });
    const good = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{"identifier":"h","appPassword":"p","accessJwt":"a","refreshJwt":"r"}', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    const bad = db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h2', displayName: 'd2', avatarUrl: null, credential: 'ENC:{"accessToken":"tok"}', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });

    const result = await model.post(1, { accountIds: [good.id, bad.id], text: 'hi' });
    const goodResult = result.results.find(r => r.accountId === good.id);
    const badResult = result.results.find(r => r.accountId === bad.id);
    assert.equal(goodResult.isSuccess, true);
    assert.ok(goodResult.url.startsWith('https://bsky.app/profile/h/post/'));
    assert.equal(badResult.isSuccess, false);
    // Misskey のエラーは code (機械可読な種別) も detail に含める。message だけでは
    // 「INVALID_PARAM」なのか「容量超過」なのか利用者が判断できないため
    assert.equal(badResult.detail, 'RATE_LIMIT_EXCEEDED: rate limited');
});

// 実機 (misskey.io) で write:reactions の無いトークンを使うと PERMISSION_DENIED が返ることを確認済み。
// この系統のエラーは再試行では直らない (MiAuth は permission がトークン発行時に固定される) ため、
// 再連携を促す文言に変換して伝える
test('post() は Misskey が PERMISSION_DENIED を返すと再連携を促す文言に変換して伝える', async () => {
    const misskeyClient = {
        createNote: async () => {
            throw new MisskeyApiError(403, 'PERMISSION_DENIED', 'Your app does not have the necessary permissions to use this endpoint.');
        },
    };
    const { db, model } = makeModel({ misskeyClient });
    const row = db.seed({ provider: 'misskey', userId: 1, remoteUserId: 'u1', instanceUrl: 'misskey.io', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'ENC:{"accessToken":"tok"}', defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });

    const result = await model.post(1, { accountIds: [row.id], text: 'hi' });
    assert.equal(result.results[0].isSuccess, false);
    assert.match(result.results[0].detail, /再連携/);
    assert.match(result.results[0].detail, /PERMISSION_DENIED/);
});

test('post() は credential が未暗号化 (再連携が必要) なアカウントを SnsAccountNeedsReauth で失敗させる', async () => {
    const { db, model } = makeModel();
    const row = db.seed({ provider: 'bluesky', userId: 1, remoteUserId: 'did:1', instanceUrl: 'bsky.social', handle: 'h', displayName: 'd', avatarUrl: null, credential: 'plain-text-not-encrypted', defaultVisibility: null, defaultChannelId: null, defaultChannelName: null, isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1 });
    const result = await model.post(1, { accountIds: [row.id], text: 'hi' });
    assert.equal(result.results[0].isSuccess, false);
    assert.equal(result.results[0].detail, 'SnsAccountNeedsReauth');
});

test('post() の Bluesky 投稿は 401 を受けると refreshSession() で再試行し成功する', async () => {
    let createPostCalls = 0;
    const blueskyClient = {
        createPost: async accessJwt => {
            createPostCalls++;
            if (accessJwt === 'old-access') throw new BlueskyApiError(401, 'expired');
            return { uri: 'at://did:1/app.bsky.feed.post/xyz', cid: 'c2' };
        },
        refresh: async refreshJwt => {
            assert.equal(refreshJwt, 'old-refresh');
            return { did: 'did:1', handle: 'h', accessJwt: 'new-access', refreshJwt: 'new-refresh' };
        },
    };
    const { db, model } = makeModel({ blueskyClient });
    const row = db.seed({
        provider: 'bluesky',
        userId: 1,
        remoteUserId: 'did:1',
        instanceUrl: 'bsky.social',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"identifier":"h","appPassword":"p","accessJwt":"old-access","refreshJwt":"old-refresh"}',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const result = await model.post(1, { accountIds: [row.id], text: 'hi' });
    assert.equal(result.results[0].isSuccess, true);
    assert.equal(createPostCalls, 2);

    const updated = await db.findById(row.id);
    const credential = JSON.parse(updated.credential.slice(4));
    assert.equal(credential.accessJwt, 'new-access');
});

test('post() の Bluesky 投稿は refreshSession() も失敗したら保存済み App Password で再ログインする', async () => {
    let loginCalls = 0;
    const blueskyClient = {
        createPost: async accessJwt => {
            if (accessJwt === 'old-access') throw new BlueskyApiError(401, 'expired');
            return { uri: 'at://did:1/app.bsky.feed.post/xyz', cid: 'c3' };
        },
        refresh: async () => {
            throw new BlueskyApiError(401, 'refresh token expired');
        },
        login: async (identifier, appPassword) => {
            loginCalls++;
            assert.equal(identifier, 'h');
            assert.equal(appPassword, 'saved-app-password');
            return { did: 'did:1', handle: 'h', accessJwt: 'relogin-access', refreshJwt: 'relogin-refresh' };
        },
    };
    const { db, model } = makeModel({ blueskyClient });
    const row = db.seed({
        provider: 'bluesky',
        userId: 1,
        remoteUserId: 'did:1',
        instanceUrl: 'bsky.social',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential:
            'ENC:{"identifier":"h","appPassword":"saved-app-password","accessJwt":"old-access","refreshJwt":"old-refresh"}',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const result = await model.post(1, { accountIds: [row.id], text: 'hi' });
    assert.equal(result.results[0].isSuccess, true);
    assert.equal(loginCalls, 1);

    const updated = await db.findById(row.id);
    const credential = JSON.parse(updated.credential.slice(4));
    assert.equal(credential.accessJwt, 'relogin-access');
});

test('post() の Bluesky 投稿は画像が Bluesky の 2MB 上限を超えると拒否する', async () => {
    const { db, model } = makeModel({ blueskyClient: {} });
    const row = db.seed({
        provider: 'bluesky',
        userId: 1,
        remoteUserId: 'did:1',
        instanceUrl: 'bsky.social',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"identifier":"h","appPassword":"p","accessJwt":"a","refreshJwt":"r"}',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });
    // 2MB を超える data URL (base64 換算で余裕を持って超過させる)
    const bigBase64 = Buffer.alloc(3 * 1024 * 1024).toString('base64');
    const result = await model.post(1, {
        accountIds: [row.id],
        text: 'hi',
        images: [{ dataUrl: `data:image/jpeg;base64,${bigBase64}` }],
    });
    assert.equal(result.results[0].isSuccess, false);
    assert.equal(result.results[0].detail, 'SnsPostImageTooLarge');
});

test('post() の Misskey 投稿はチャンネル指定時に画像をアップロードしノートを作成する', async () => {
    const uploadCalls = [];
    const noteCalls = [];
    const misskeyClient = {
        uploadFile: async (host, token, buffer, filename) => {
            uploadCalls.push({ host, token, filename });
            return 'file-1';
        },
        createNote: async (host, token, option) => {
            noteCalls.push(option);
            return { id: 'note1', url: 'https://misskey.io/notes/note1' };
        },
    };
    const { db, model } = makeModel({ misskeyClient });
    const row = db.seed({
        provider: 'misskey',
        userId: 1,
        remoteUserId: 'u1',
        instanceUrl: 'misskey.io',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"accessToken":"tok-1"}',
        defaultVisibility: 'home',
        defaultChannelId: 'ch1',
        defaultChannelName: 'Channel 1',
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const result = await model.post(1, {
        accountIds: [row.id],
        text: 'hi',
        images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
    });

    assert.equal(result.results[0].isSuccess, true);
    assert.equal(result.results[0].url, 'https://misskey.io/notes/note1');
    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].token, 'tok-1');
    assert.deepEqual(noteCalls[0].fileIds, ['file-1']);
    // アカウントの defaultChannelId が引き継がれる
    assert.equal(noteCalls[0].channelId, 'ch1');
});

test('post() の Bluesky 投稿は画像をアップロードしてから投稿する (2MB 以下)', async () => {
    const uploadCalls = [];
    const blueskyClient = {
        uploadBlob: async (accessJwt, buffer, mimeType, service) => {
            uploadCalls.push({ accessJwt, mimeType, service });
            return { $type: 'blob', ref: { $link: 'bafy1' }, mimeType, size: buffer.length };
        },
        createPost: async (accessJwt, did, option) => {
            assert.equal(option.images.length, 1);
            assert.equal(option.images[0].blob.ref.$link, 'bafy1');
            return { uri: 'at://did:1/app.bsky.feed.post/img1', cid: 'c' };
        },
    };
    const { db, model } = makeModel({ blueskyClient });
    const row = db.seed({
        provider: 'bluesky',
        userId: 1,
        remoteUserId: 'did:1',
        instanceUrl: 'bsky.social',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"identifier":"h","appPassword":"p","accessJwt":"a","refreshJwt":"r"}',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const result = await model.post(1, {
        accountIds: [row.id],
        text: 'hi',
        images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
    });
    assert.equal(result.results[0].isSuccess, true);
    assert.equal(uploadCalls.length, 1);
});

test('post() の Bluesky 投稿は 401 以外のエラーを再試行せずそのまま失敗として伝える', async () => {
    const blueskyClient = {
        createPost: async () => {
            throw new BlueskyApiError(500, 'internal server error');
        },
    };
    const { db, model } = makeModel({ blueskyClient });
    const row = db.seed({
        provider: 'bluesky',
        userId: 1,
        remoteUserId: 'did:1',
        instanceUrl: 'bsky.social',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"identifier":"h","appPassword":"p","accessJwt":"a","refreshJwt":"r"}',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const result = await model.post(1, { accountIds: [row.id], text: 'hi' });
    assert.equal(result.results[0].isSuccess, false);
    assert.equal(result.results[0].detail, 'internal server error');
});

test('post() は Error でない値が投げられても文字列化して detail に残す', async () => {
    const misskeyClient = {
        createNote: async () => {
            // eslint-disable-next-line no-throw-literal
            throw 'raw string failure';
        },
    };
    const { db, model } = makeModel({ misskeyClient });
    const row = db.seed({
        provider: 'misskey',
        userId: 1,
        remoteUserId: 'u1',
        instanceUrl: 'misskey.io',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"accessToken":"tok"}',
        defaultVisibility: 'public',
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const result = await model.post(1, { accountIds: [row.id], text: 'hi' });
    assert.equal(result.results[0].isSuccess, false);
    assert.equal(result.results[0].detail, 'raw string failure');
});

test('post() の Misskey 投稿は画像の mime type から拡張子を推定し、uploadFile へ実際の mime type を渡す (webp / gif / それ以外)', async () => {
    const filenames = [];
    const mimeTypes = [];
    const misskeyClient = {
        uploadFile: async (host, token, buffer, filename, mimeType) => {
            filenames.push(filename);
            mimeTypes.push(mimeType);
            return `file-${filenames.length}`;
        },
        createNote: async () => ({ id: 'note-x', url: 'https://misskey.io/notes/note-x' }),
    };
    const { db, model } = makeModel({ misskeyClient });
    const row = db.seed({
        provider: 'misskey',
        userId: 1,
        remoteUserId: 'u1',
        instanceUrl: 'misskey.io',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"accessToken":"tok"}',
        defaultVisibility: 'public',
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    await model.post(1, {
        accountIds: [row.id],
        text: 'hi',
        images: [
            { dataUrl: 'data:image/webp;base64,AAAA' },
            { dataUrl: 'data:image/gif;base64,AAAA' },
            { dataUrl: 'data:image/bmp;base64,AAAA' },
        ],
    });

    assert.match(filenames[0], /\.webp$/);
    assert.match(filenames[1], /\.gif$/);
    assert.match(filenames[2], /\.jpg$/);
    // 拡張子だけでなく、data URL から取り出した実際の MIME type がそのまま渡っていることを確認する
    // (Blob に MIME type が渡っていないと Misskey 側に application/octet-stream として届く)
    assert.deepEqual(mimeTypes, ['image/webp', 'image/gif', 'image/bmp']);
});

test('post() の Misskey 投稿はリクエストの misskey オプションでアカウントの既定値を上書きできる', async () => {
    const noteCalls = [];
    const misskeyClient = {
        createNote: async (host, token, option) => {
            noteCalls.push(option);
            return { id: 'note2', url: 'https://misskey.io/notes/note2' };
        },
    };
    const { db, model } = makeModel({ misskeyClient });
    const row = db.seed({
        provider: 'misskey',
        userId: 1,
        remoteUserId: 'u1',
        instanceUrl: 'misskey.io',
        handle: 'h',
        displayName: 'd',
        avatarUrl: null,
        credential: 'ENC:{"accessToken":"tok-1"}',
        defaultVisibility: 'public',
        defaultChannelId: 'default-ch',
        defaultChannelName: 'Default',
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

    await model.post(1, {
        accountIds: [row.id],
        text: 'hi',
        misskey: { visibility: 'followers', localOnly: true, channelId: null, cw: 'spoiler' },
    });

    assert.equal(noteCalls[0].visibility, 'followers');
    assert.equal(noteCalls[0].localOnly, true);
    assert.equal(noteCalls[0].channelId, null);
    assert.equal(noteCalls[0].cw, 'spoiler');
});
