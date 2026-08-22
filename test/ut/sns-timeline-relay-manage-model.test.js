'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const SnsTimelineRelayManageModel = require('../../dist/model/service/sns/SnsTimelineRelayManageModel').default;

// ws 互換の最小フェイク実装 (open/message/close/error イベントと send/close だけを持つ)
class FakeWebSocket extends EventEmitter {
    constructor() {
        super();
        this.OPEN = 1;
        this.CLOSED = 3;
        this.readyState = 1;
        this.sent = [];
        this.closeCalled = 0;
    }

    send(data) {
        this.sent.push(JSON.parse(data));
    }

    close() {
        this.closeCalled += 1;
        this.readyState = this.CLOSED;
    }
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} };
const makeLoggerModel = () => ({ initialize: () => {}, getLogger: () => ({ system: noopLog, access: noopLog, stream: noopLog, encode: noopLog }) });

const makeSnsAccountDB = rows => ({
    async findById(id) {
        return rows.find(r => r.id === id) ?? null;
    },
});

const makeCrypto = () => ({
    getSigningKey: () => null,
    encrypt: value => `ENC:${value}`,
    decrypt: value => (value.startsWith('ENC:') ? value.slice(4) : value),
    isEncrypted: value => value.startsWith('ENC:'),
    mask: value => value,
});

const misskeyAccount = (override = {}) => ({
    id: 1,
    provider: 'misskey',
    userId: 10,
    instanceUrl: 'misskey.io',
    credential: `ENC:${JSON.stringify({ accessToken: 'tok' })}`,
    ...override,
});

const waitUntil = async predicate => {
    for (let i = 0; i < 400; i++) {
        if ((await predicate()) === true) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timeout waiting for condition');
};

const makeMisskeyClient = (emojis = []) => ({
    async getEmojis() {
        return emojis;
    },
});

const makeModel = ({ rows = [misskeyAccount()], connects = [], crypto, misskeyClient, reconnectDelayFn } = {}) => {
    const connector = {
        connectCallCount: 0,
        connect(host, token) {
            this.connectCallCount += 1;
            const ws = new FakeWebSocket();
            connects.push({ host, token, ws });
            return ws;
        },
    };
    const model = new SnsTimelineRelayManageModel(
        makeLoggerModel(),
        makeSnsAccountDB(rows),
        crypto ?? makeCrypto(),
        connector,
        misskeyClient ?? makeMisskeyClient(),
        reconnectDelayFn,
    );

    return { model, connector, connects };
};

test('存在しないアカウントを購読しようとするとエラーを返し、上流には接続しない', async () => {
    const { model, connector } = makeModel({ rows: [] });
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 999, timelineType: 'home' })));
    await waitUntil(async () => client.sent.length > 0);
    assert.equal(client.sent[0].type, 'error');
    assert.equal(client.sent[0].message, 'SnsAccountIsNull');
    assert.equal(connector.connectCallCount, 0);
});

test('他人のアカウントを購読しようとするとエラーを返す (userId 不一致)', async () => {
    const { model } = makeModel({ rows: [misskeyAccount({ userId: 1 })] });
    const client = new FakeWebSocket();
    model.start(client, 999);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => client.sent.length > 0);
    assert.equal(client.sent[0].message, 'SnsAccountIsNull');
});

test('Bluesky アカウントの購読は拒否する (WS 中継は Misskey のみ)', async () => {
    const { model } = makeModel({ rows: [misskeyAccount({ provider: 'bluesky' })] });
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => client.sent.length > 0);
    assert.equal(client.sent[0].message, 'SnsTimelineWsProviderNotSupported');
});

test('credential が未暗号化 (再連携が必要) なアカウントは拒否する', async () => {
    const { model } = makeModel({ rows: [misskeyAccount({ credential: 'plain' })] });
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => client.sent.length > 0);
    assert.equal(client.sent[0].message, 'SnsAccountNeedsReauth');
});

test('type: channel で channelId 未指定なら拒否する', async () => {
    const { model } = makeModel();
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'channel' })));
    await waitUntil(async () => client.sent.length > 0);
    assert.equal(client.sent[0].message, 'SnsTimelineChannelIdIsRequired');
});

test('正常な購読は上流へ接続し、connect メッセージを送って subscribed を通知する', async () => {
    const { model, connects } = makeModel();
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'social' })));
    await waitUntil(async () => connects.length > 0);

    const upstream = connects[0].ws;
    assert.equal(connects[0].host, 'misskey.io');
    assert.equal(connects[0].token, 'tok');

    upstream.emit('open');
    assert.equal(upstream.sent.length, 1);
    assert.equal(upstream.sent[0].type, 'connect');
    assert.equal(upstream.sent[0].body.channel, 'hybridTimeline');
    assert.equal(client.sent[client.sent.length - 1].type, 'subscribed');
});

test('上流からの note は共通形へ変換されクライアントへ転送される', async () => {
    const { model, connects } = makeModel();
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => connects.length > 0);
    const upstream = connects[0].ws;
    upstream.emit('open');
    const connectId = upstream.sent[0].body.id;

    upstream.emit(
        'message',
        Buffer.from(
            JSON.stringify({
                type: 'channel',
                body: {
                    id: connectId,
                    type: 'note',
                    body: {
                        id: 'n1',
                        createdAt: '2026-01-01T00:00:00Z',
                        text: 'hello',
                        cw: null,
                        user: { id: 'u1', username: 'foo', name: null, avatarUrl: null, host: null },
                        files: [],
                        reactions: {},
                        reactionEmojis: {},
                        myReaction: null,
                        renoteCount: 0,
                    },
                },
            }),
        ),
    );

    // 絵文字キャッシュの解決を挟むため note の送出は非同期になる
    await waitUntil(async () => client.sent.some(m => m.type === 'note'));
    const noteMsg = client.sent.find(m => m.type === 'note');
    assert.ok(typeof noteMsg !== 'undefined');
    assert.equal(noteMsg.note.id, 'n1');
    assert.equal(noteMsg.note.text, 'hello');
});

test('別の connect id (channel id) を持つメッセージは無視する', async () => {
    const { model, connects } = makeModel();
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => connects.length > 0);
    const upstream = connects[0].ws;
    upstream.emit('open');

    upstream.emit(
        'message',
        Buffer.from(JSON.stringify({ type: 'channel', body: { id: 'other-id', type: 'note', body: { id: 'n1' } } })),
    );
    assert.equal(client.sent.some(m => m.type === 'note'), false);
});

test('再購読すると古い上流接続を閉じてから新しい接続を張る (多重接続しない)', async () => {
    const { model, connects } = makeModel({ rows: [misskeyAccount({ id: 1 }), misskeyAccount({ id: 2, instanceUrl: 'misskey2.example' })] });
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => connects.length === 1);
    const firstUpstream = connects[0].ws;

    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 2, timelineType: 'home' })));
    await waitUntil(async () => connects.length === 2);

    assert.equal(firstUpstream.closeCalled, 1);
    assert.equal(connects[1].host, 'misskey2.example');
});

test('unsubscribe すると上流を閉じ、以後の close イベントで再接続しない', async () => {
    const { model, connects, connector } = makeModel();
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => connects.length > 0);
    const upstream = connects[0].ws;

    client.emit('message', Buffer.from(JSON.stringify({ type: 'unsubscribe' })));
    assert.equal(upstream.closeCalled, 1);

    // unsubscribe 後に close イベントが (非同期に) 届いても再接続しない
    upstream.emit('close');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(connector.connectCallCount, 1);
});

test('クライアント切断で上流も必ず閉じ、セッションを破棄する', async () => {
    const { model, connects } = makeModel();
    const client = new FakeWebSocket();
    model.start(client, 10);
    assert.equal(model.size(), 1);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => connects.length > 0);
    const upstream = connects[0].ws;

    client.emit('close');
    assert.equal(upstream.closeCalled, 1);
    assert.equal(model.size(), 0);
});

test('上流が予期せず切断すると再接続する (指数バックオフ)', async () => {
    const { model, connects, connector } = makeModel({ reconnectDelayFn: attempt => (attempt === 0 ? 1 : null) });
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => connects.length === 1);
    connects[0].ws.emit('open');

    // 意図しない close (unsubscribe を経ない)
    connects[0].ws.emit('close');

    await waitUntil(async () => connector.connectCallCount === 2);
    assert.equal(connects.length, 2);
    // 再接続後は同じ connectId を使い回す
    connects[1].ws.emit('open');
    assert.equal(connects[1].ws.sent[0].body.id, connects[0].ws.sent[0].body.id);
});

test('再接続の試行上限に達すると諦めてクライアントへエラーを通知する', async () => {
    const { model, connects, connector } = makeModel({ reconnectDelayFn: () => null });
    const client = new FakeWebSocket();
    model.start(client, 10);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', accountId: 1, timelineType: 'home' })));
    await waitUntil(async () => connects.length === 1);
    connects[0].ws.emit('open');
    client.sent = [];

    connects[0].ws.emit('close');

    await waitUntil(async () => client.sent.some(m => m.type === 'error' && m.message === 'SnsTimelineWsReconnectGaveUp'));
    assert.equal(connector.connectCallCount, 1);
});

test('size() は保持中のセッション数を返す', () => {
    const { model } = makeModel();
    assert.equal(model.size(), 0);
    const client1 = new FakeWebSocket();
    const client2 = new FakeWebSocket();
    model.start(client1, 10);
    model.start(client2, 10);
    assert.equal(model.size(), 2);
    client1.emit('close');
    assert.equal(model.size(), 1);
});
