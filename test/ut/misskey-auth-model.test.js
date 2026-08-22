'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const MisskeyAuthModel = require('../../dist/model/sns/MisskeyAuthModel').default;

const NOW = 1785225000000;
const MINUTE = 60 * 1000;

// IMisskeyClient のスタブ。normalizeInstanceUrl / checkAuth の挙動をテストごとに差し替える
function makeMisskeyClientStub({ normalize = input => input, checkAuthResult, checkAuthError } = {}) {
    const checkAuthCalls = [];
    return {
        checkAuthCalls,
        normalizeInstanceUrl: normalize,
        async checkAuth(host, sessionId) {
            checkAuthCalls.push({ host, sessionId });
            if (checkAuthError) throw checkAuthError;
            return checkAuthResult;
        },
    };
}

const makeConfiguration = (subDirectory) => ({
    getConfig: () => ({ subDirectory }),
});

// Date.now() をテスト中だけ差し替えるヘルパー (MisskeyAuthSessionStore は内部で Date.now() の既定引数を使うため)
const withFixedNow = async (now, fn) => {
    const original = Date.now;
    Date.now = () => now;
    try {
        return await fn();
    } finally {
        Date.now = original;
    }
};

test('createSession() はホストを正規化し、名前 / callback / permission を含む認可 URL を組み立てる', () => {
    const misskeyClient = makeMisskeyClientStub({ normalize: () => 'misskey.io' });
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    const result = model.createSession('https://misskey.io/', 10, 'http://localhost:8888');

    assert.ok(result.sessionId.length > 0);
    assert.ok(result.authUrl.startsWith(`https://misskey.io/miauth/${result.sessionId}?`));
    const query = new URL(result.authUrl).searchParams;
    assert.equal(query.get('name'), 'EPGStation');
    assert.equal(query.get('callback'), 'http://localhost:8888/api/sns/misskey/callback');
    assert.equal(query.get('permission'), 'write:notes,write:drive,read:account,read:channels,write:reactions');
});

test('createSession() は subDirectory 運用でも callback にプレフィックスを含める', () => {
    const misskeyClient = makeMisskeyClientStub({ normalize: () => 'misskey.io' });
    const model = new MisskeyAuthModel(makeConfiguration('epgstation'), misskeyClient);

    const result = model.createSession('misskey.io', null, 'http://localhost:8888');
    const query = new URL(result.authUrl).searchParams;
    assert.equal(query.get('callback'), 'http://localhost:8888/epgstation/api/sns/misskey/callback');
});

test('createSession() は正規化後のホストが空文字ならインスタンス URL 不正として拒否する', () => {
    const misskeyClient = makeMisskeyClientStub({ normalize: () => '' });
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    assert.throws(() => model.createSession('not a url', null, 'http://localhost:8888'), /MisskeyInstanceUrlIsInvalid/);
});

test('completeSession() は存在しない session を拒否する', async () => {
    const misskeyClient = makeMisskeyClientStub();
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    await assert.rejects(() => model.completeSession('no-such-session', null), /MisskeyAuthSessionNotFound/);
});

test('completeSession() は session を作った userId と異なるコールバックを拒否する (取り違え対策)', async () => {
    const misskeyClient = makeMisskeyClientStub({ normalize: () => 'misskey.io' });
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    const { sessionId } = model.createSession('misskey.io', 10, 'http://localhost:8888');

    await assert.rejects(() => model.completeSession(sessionId, 999), /MisskeyAuthSessionUserMismatch/);
    // ユーザー不一致で拒否された場合でもセッションは残らない実装ではないので、
    // 二重にチェックするのではなく拒否そのものを確認するだけに留める
});

test('completeSession() は TTL (10 分) を超えたセッションを拒否する', async () => {
    const misskeyClient = makeMisskeyClientStub({ normalize: () => 'misskey.io' });
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    const { sessionId } = await withFixedNow(NOW, () => model.createSession('misskey.io', null, 'http://localhost:8888'));

    await withFixedNow(NOW + 11 * MINUTE, () =>
        assert.rejects(() => model.completeSession(sessionId, null), /MisskeyAuthSessionNotFound/),
    );
});

test('completeSession() は成功時に checkAuth を呼びトークンとユーザー情報を返し、セッションを使い切る', async () => {
    const misskeyClient = makeMisskeyClientStub({
        normalize: () => 'misskey.io',
        checkAuthResult: {
            ok: true,
            token: 'tok-1',
            user: { id: 'u1', username: 'foo', name: null, avatarUrl: 'https://x/a.png', host: null },
        },
    });
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    const { sessionId } = model.createSession('misskey.io', 10, 'http://localhost:8888');
    const result = await model.completeSession(sessionId, 10);

    assert.equal(result.host, 'misskey.io');
    assert.equal(result.token, 'tok-1');
    assert.equal(result.remoteUserId, 'u1');
    assert.equal(result.handle, 'foo');
    // name が null のときは username を displayName の代わりに使う
    assert.equal(result.displayName, 'foo');
    assert.equal(result.avatarUrl, 'https://x/a.png');
    assert.deepEqual(misskeyClient.checkAuthCalls, [{ host: 'misskey.io', sessionId }]);

    // 一度使ったセッションは再利用できない
    await assert.rejects(() => model.completeSession(sessionId, 10), /MisskeyAuthSessionNotFound/);
});

test('completeSession() は要求した permission 一覧を grantedPermissions として返す (トークン発行時の権限を DB へ記録するため)', async () => {
    const misskeyClient = makeMisskeyClientStub({
        normalize: () => 'misskey.io',
        checkAuthResult: {
            ok: true,
            token: 'tok-1',
            user: { id: 'u1', username: 'foo', name: null, avatarUrl: null, host: null },
        },
    });
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    const { sessionId } = model.createSession('misskey.io', 10, 'http://localhost:8888');
    const result = await model.completeSession(sessionId, 10);

    assert.deepEqual(result.grantedPermissions, model.getRequiredPermissions());
    assert.deepEqual(result.grantedPermissions, ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions']);
});

test('getRequiredPermissions() は現在アプリが要求する permission 一覧を返す', () => {
    const model = new MisskeyAuthModel(makeConfiguration(undefined), makeMisskeyClientStub());
    assert.deepEqual(model.getRequiredPermissions(), ['write:notes', 'write:drive', 'read:account', 'read:channels', 'write:reactions']);
});

test('completeSession() は Misskey が承認されていない (ok:false) を返すクライアントの例外をそのまま伝える', async () => {
    const misskeyClient = makeMisskeyClientStub({
        normalize: () => 'misskey.io',
        checkAuthError: new Error('MiAuth session was not approved'),
    });
    const model = new MisskeyAuthModel(makeConfiguration(undefined), misskeyClient);

    const { sessionId } = model.createSession('misskey.io', null, 'http://localhost:8888');
    await assert.rejects(() => model.completeSession(sessionId, null), /MiAuth session was not approved/);
});
