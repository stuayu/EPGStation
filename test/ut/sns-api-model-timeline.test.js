'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SnsApiModel = require('../../dist/model/api/sns/SnsApiModel').default;
const { BlueskyApiError } = require('../../dist/model/sns/IBlueskyClient');

// ------------------------------------------------------------------
// スタブ群 (test/ut/sns-api-model.test.js と同じ流儀)
// ------------------------------------------------------------------

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
        async findDuplicate() {
            return null;
        },
        seed(row) {
            const id = nextId++;
            const saved = { id, ...row };
            rows.set(id, saved);
            return saved;
        },
    };
}

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
        model: new SnsApiModel(makeLoggerModel(), db, crypto ?? makeCrypto(), blueskyClient, misskeyClient, misskeyAuthModel),
    };
};

const seedMisskeyAccount = (db, userId = 1) =>
    db.seed({
        provider: 'misskey',
        userId,
        remoteUserId: 'u1',
        instanceUrl: 'misskey.io',
        handle: 'foo',
        displayName: 'Foo',
        avatarUrl: null,
        credential: `ENC:${JSON.stringify({ accessToken: 'tok' })}`,
        defaultVisibility: 'public',
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

const seedBlueskyAccount = (db, userId = 1) =>
    db.seed({
        provider: 'bluesky',
        userId,
        remoteUserId: 'did:plc:abc',
        instanceUrl: 'bsky.social',
        handle: 'user.bsky.social',
        displayName: 'User',
        avatarUrl: null,
        credential: `ENC:${JSON.stringify({ identifier: 'user', appPassword: 'pass', accessJwt: 'a', refreshJwt: 'r' })}`,
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });

// ------------------------------------------------------------------
// getTimeline
// ------------------------------------------------------------------

test('getTimeline() は Misskey アカウントで misskeyClient.getTimeline を呼び、cursor は最後のノート id になる', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    let seenOption;
    const misskeyClient = {
        getTimeline: async (host, token, option) => {
            seenOption = { host, token, option };
            return [
                { id: 'n1', createdAt: '2026-01-01T00:00:00Z', text: 'a', cw: null, user: { id: 'u', username: 'u', name: null, avatarUrl: null, host: null }, files: [], reactions: {}, reactionEmojis: {}, myReaction: null, renoteCount: 0, renote: null },
                { id: 'n2', createdAt: '2026-01-01T00:00:00Z', text: 'b', cw: null, user: { id: 'u', username: 'u', name: null, avatarUrl: null, host: null }, files: [], reactions: {}, reactionEmojis: {}, myReaction: null, renoteCount: 0, renote: null },
            ];
        },
        // リアクション絵文字の解決に使う (ここでは空でよい。解決自体は misskey-timeline-converter.test.js で検証する)
        getEmojis: async () => [],
    };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.getTimeline(1, account.id, 'social', undefined, 5, 'until1');
    assert.equal(seenOption.host, 'misskey.io');
    assert.equal(seenOption.token, 'tok');
    assert.deepEqual(seenOption.option, { type: 'social', channelId: undefined, limit: 5, untilId: 'until1' });
    assert.equal(result.notes.length, 2);
    assert.equal(result.cursor, 'n2');
});

test('getTimeline() は notes が空なら cursor を null にする', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    const misskeyClient = { getTimeline: async () => [], getEmojis: async () => [] };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.getTimeline(1, account.id, 'home', undefined, undefined, undefined);
    assert.equal(result.cursor, null);
});

test('getTimeline() は misskeyClient.getEmojis の一覧でリアクション絵文字の url を解決する', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    const misskeyClient = {
        getTimeline: async () => [
            {
                id: 'n1',
                createdAt: '2026-01-01T00:00:00Z',
                text: 'a',
                cw: null,
                user: { id: 'u', username: 'u', name: null, avatarUrl: null, host: null },
                files: [],
                // reactionEmojis が空 (WebSocket 中継相当) でもキャッシュから解決できることを確認する
                reactions: { ':party:': 1 },
                reactionEmojis: {},
                myReaction: null,
                renoteCount: 0,
                renote: null,
            },
        ],
        getEmojis: async host => (host === 'misskey.io' ? [{ name: 'party', url: 'https://misskey.io/party.png', category: null, aliases: [] }] : []),
    };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.getTimeline(1, account.id, 'home', undefined, undefined, undefined);
    assert.equal(result.notes[0].reactions[0].url, 'https://misskey.io/party.png');
});

test('getTimeline() は Misskey で type: channel かつ channelId 未指定なら拒否する', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    const { model } = makeModel({ snsAccountDB: db });
    await assert.rejects(
        () => model.getTimeline(1, account.id, 'channel', undefined, undefined, undefined),
        /SnsTimelineChannelIdIsRequired/,
    );
});

test('getTimeline() は Bluesky アカウントで blueskyClient.getTimeline を呼ぶ', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    let called = false;
    const blueskyClient = {
        getTimeline: async (accessJwt, option, service) => {
            called = true;
            assert.equal(accessJwt, 'a');
            assert.equal(service, 'bsky.social');
            return { feed: [{ post: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'c', author: { did: 'd', handle: 'h' }, record: { text: 't' } } }], cursor: 'next' };
        },
    };
    const { model } = makeModel({ blueskyClient, snsAccountDB: db });
    const result = await model.getTimeline(1, account.id, undefined, undefined, undefined, undefined);
    assert.equal(called, true);
    assert.equal(result.notes.length, 1);
    assert.equal(result.cursor, 'next');
});

test('getTimeline() は他人のアカウントを拒否する', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db, 1);
    const { model } = makeModel({ snsAccountDB: db });
    await assert.rejects(() => model.getTimeline(999, account.id, undefined, undefined, undefined, undefined), /SnsAccountIsNull/);
});

// ------------------------------------------------------------------
// getMisskeyEmojis
// ------------------------------------------------------------------

test('getMisskeyEmojis() は misskeyClient.getEmojis の結果をそのまま包む', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    const misskeyClient = { getEmojis: async host => (host === 'misskey.io' ? [{ name: 'a', url: 'u', category: null, aliases: [] }] : []) };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.getMisskeyEmojis(1, account.id);
    assert.equal(result.emojis.length, 1);
});

test('getMisskeyEmojis() は Bluesky アカウントを拒否する', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    const { model } = makeModel({ snsAccountDB: db });
    await assert.rejects(() => model.getMisskeyEmojis(1, account.id), /SnsAccountIsNull/);
});

// ------------------------------------------------------------------
// addReaction / removeReaction
// ------------------------------------------------------------------

test('addReaction() は Misskey で reaction 省略時は既定の絵文字を使う', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    let seenReaction;
    const misskeyClient = { createReaction: async (host, token, noteId, reaction) => { seenReaction = reaction; } };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.addReaction(1, { accountId: account.id, noteId: 'note1' });
    assert.equal(result.isSuccess, true);
    assert.equal(typeof seenReaction, 'string');
    assert.ok(seenReaction.length > 0);
});

test('addReaction() は Bluesky で cid が無ければ失敗を返す (例外にしない)', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    const { model } = makeModel({ snsAccountDB: db });
    const result = await model.addReaction(1, { accountId: account.id, noteId: 'at://x/app.bsky.feed.post/1' });
    assert.equal(result.isSuccess, false);
    assert.equal(result.detail, 'SnsReactionCidIsRequired');
});

test('addReaction() は Bluesky で成功すると reactionKey (like レコードの rkey) を返す', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    const blueskyClient = { like: async () => ({ uri: 'at://did:plc:abc/app.bsky.feed.like/likekey1' }) };
    const { model } = makeModel({ blueskyClient, snsAccountDB: db });
    const result = await model.addReaction(1, { accountId: account.id, noteId: 'at://x/app.bsky.feed.post/1', cid: 'c' });
    assert.equal(result.isSuccess, true);
    assert.equal(result.reactionKey, 'likekey1');
});

test('addReaction() は失敗しても例外を投げず isSuccess:false + detail を返す', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    const misskeyClient = { createReaction: async () => { throw new Error('boom'); } };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.addReaction(1, { accountId: account.id, noteId: 'note1' });
    assert.equal(result.isSuccess, false);
    assert.equal(result.detail, 'boom');
});

test('removeReaction() は Misskey で noteId だけを渡す', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    let called = false;
    const misskeyClient = { deleteReaction: async (host, token, noteId) => { called = true; assert.equal(noteId, 'note1'); } };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.removeReaction(1, { accountId: account.id, noteId: 'note1' });
    assert.equal(called, true);
    assert.equal(result.isSuccess, true);
});

test('removeReaction() は Bluesky で reactionKey が無ければ失敗を返す', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    const { model } = makeModel({ snsAccountDB: db });
    const result = await model.removeReaction(1, { accountId: account.id, noteId: 'at://x/app.bsky.feed.post/1' });
    assert.equal(result.isSuccess, false);
    assert.equal(result.detail, 'SnsReactionKeyIsRequired');
});

test('removeReaction() は Bluesky で reactionKey (rkey) を deleteLike に渡す', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    let seenRkey;
    const blueskyClient = { deleteLike: async (accessJwt, did, rkey) => { seenRkey = rkey; } };
    const { model } = makeModel({ blueskyClient, snsAccountDB: db });
    const result = await model.removeReaction(1, { accountId: account.id, noteId: 'x', reactionKey: 'likekey1' });
    assert.equal(seenRkey, 'likekey1');
    assert.equal(result.isSuccess, true);
});

// ------------------------------------------------------------------
// renote
// ------------------------------------------------------------------

test('renote() は Misskey で misskeyClient.renote を呼び url を返す', async () => {
    const db = makeSnsAccountDB();
    const account = seedMisskeyAccount(db);
    const misskeyClient = { renote: async () => ({ id: 'n2', url: 'https://misskey.io/notes/n2' }) };
    const { model } = makeModel({ misskeyClient, snsAccountDB: db });
    const result = await model.renote(1, { accountId: account.id, noteId: 'note1' });
    assert.equal(result.isSuccess, true);
    assert.equal(result.url, 'https://misskey.io/notes/n2');
});

test('renote() は Bluesky で cid が無ければ失敗を返す', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    const { model } = makeModel({ snsAccountDB: db });
    const result = await model.renote(1, { accountId: account.id, noteId: 'at://x/app.bsky.feed.post/1' });
    assert.equal(result.isSuccess, false);
    assert.equal(result.detail, 'SnsReactionCidIsRequired');
});

test('renote() は Bluesky で成功すると元投稿の bsky.app URL を返す (repost レコードの rkey は使わない)', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    const blueskyClient = { repost: async () => ({ uri: 'at://did:plc:abc/app.bsky.feed.repost/rp1' }) };
    const { model } = makeModel({ blueskyClient, snsAccountDB: db });
    const result = await model.renote(1, { accountId: account.id, noteId: 'at://did:plc:xyz/app.bsky.feed.post/orig1', cid: 'c' });
    assert.equal(result.isSuccess, true);
    assert.equal(result.url, 'https://bsky.app/profile/did:plc:xyz/post/orig1');
});

test('401 を受けたら refresh() で再試行する (Bluesky 系呼び出し共通)', async () => {
    const db = makeSnsAccountDB();
    const account = seedBlueskyAccount(db);
    let attempt = 0;
    const blueskyClient = {
        like: async () => {
            attempt += 1;
            if (attempt === 1) throw new BlueskyApiError(401, 'expired');
            return { uri: 'at://did:plc:abc/app.bsky.feed.like/lk1' };
        },
        refresh: async () => ({ did: 'did:plc:abc', handle: 'user.bsky.social', accessJwt: 'new-a', refreshJwt: 'new-r' }),
    };
    const { model } = makeModel({ blueskyClient, snsAccountDB: db });
    const result = await model.addReaction(1, { accountId: account.id, noteId: 'at://x/app.bsky.feed.post/1', cid: 'c' });
    assert.equal(result.isSuccess, true);
    assert.equal(attempt, 2);
});
