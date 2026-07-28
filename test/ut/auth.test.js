'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { hashPassword, verifyPassword, assertValidPassword } = require('../../dist/model/auth/PasswordHash');
const { createSessionToken, verifySessionToken, readCookie } = require('../../dist/model/auth/SessionToken');
const { isPublicApiPath, toApiPath } = require('../../dist/model/auth/AuthGuard');
const AuthModel = require('../../dist/model/auth/AuthModel').default;

test('password hashing is salted (the same password produces different hashes)', () => {
    const a = hashPassword('correct horse battery');
    const b = hashPassword('correct horse battery');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('scrypt$'));
    assert.equal(verifyPassword('correct horse battery', a), true);
    assert.equal(verifyPassword('correct horse battery', b), true);
});

test('password verification rejects wrong passwords and broken hashes', () => {
    const stored = hashPassword('correct horse battery');
    assert.equal(verifyPassword('wrong password', stored), false);
    assert.equal(verifyPassword('correct horse battery', 'not-a-hash'), false);
    assert.equal(verifyPassword('correct horse battery', 'scrypt$1$2$3$zz$zz'), false);
    assert.equal(verifyPassword('correct horse battery', ''), false);
});

test('password length is validated', () => {
    assert.throws(() => assertValidPassword('short'), /PasswordIsTooShort/);
    assert.throws(() => assertValidPassword('a'.repeat(201)), /PasswordIsTooLong/);
    assert.throws(() => assertValidPassword(12345678), /InvalidPassword/);
    assertValidPassword('12345678');
});

test('session tokens round trip and carry the identity', () => {
    const payload = { uid: 1, name: 'admin', exp: Date.now() + 1000, ver: 3 };
    const token = createSessionToken(payload, 'secret');
    assert.deepEqual(verifySessionToken(token, 'secret'), payload);
});

test('session tokens are rejected when tampered with, expired or signed by another key', () => {
    const token = createSessionToken({ uid: 1, name: 'admin', exp: Date.now() + 1000, ver: 1 }, 'secret');
    assert.equal(verifySessionToken(token, 'another-secret'), null);
    // 署名を 1 文字書き換える
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    assert.equal(verifySessionToken(tampered, 'secret'), null);
    // 本文だけ差し替えても署名が合わない
    const forged = `${Buffer.from(JSON.stringify({ uid: 2, name: 'x', exp: Date.now() + 1000, ver: 1 })).toString('base64url')}.${token.split('.')[1]}`;
    assert.equal(verifySessionToken(forged, 'secret'), null);

    const expired = createSessionToken({ uid: 1, name: 'admin', exp: Date.now() - 1, ver: 1 }, 'secret');
    assert.equal(verifySessionToken(expired, 'secret'), null);
    assert.equal(verifySessionToken(undefined, 'secret'), null);
    assert.equal(verifySessionToken('garbage', 'secret'), null);
});

test('cookies are read without pulling in a parser dependency', () => {
    assert.equal(readCookie('a=1; epgstation_session=abc; b=2', 'epgstation_session'), 'abc');
    assert.equal(readCookie('epgstation_session=a%20b', 'epgstation_session'), 'a b');
    assert.equal(readCookie('other=1', 'epgstation_session'), null);
    assert.equal(readCookie(undefined, 'epgstation_session'), null);
});

test('only the login related endpoints are reachable without a session', () => {
    for (const path of ['/auth', '/auth/login', '/auth/logout', '/auth/setup', '/version', '/auth/']) {
        assert.equal(isPublicApiPath(path), true, path);
    }
    for (const path of ['/recorded', '/auth/users', '/config', '/settings/system', '']) {
        assert.equal(isPublicApiPath(path), false, path);
    }
});

test('api paths are extracted with the sub directory taken into account', () => {
    assert.equal(toApiPath('/api/recorded?limit=1', '/api'), '/recorded');
    assert.equal(toApiPath('/api', '/api'), '/');
    assert.equal(toApiPath('/epg/api/auth/login', '/epg/api'), '/auth/login');
    // API 以外 (クライアントの静的ファイル) は null
    assert.equal(toApiPath('/index.html', '/api'), null);
    assert.equal(toApiPath('/apixyz', '/api'), null);
});

/**
 * AuthModel は DB とだけやり取りするので、DB をスタブに差し替えて検証する
 */
function authFixture(options = {}) {
    const users = new Map();
    let nextId = 1;
    const db = {
        count: async () => users.size,
        findAll: async () => [...users.values()],
        findById: async id => users.get(id) ?? null,
        findByName: async name => [...users.values()].find(u => u.name === name) ?? null,
        create: async value => {
            const user = { ...value, id: nextId++, tokenVersion: 1 };
            users.set(user.id, user);
            return user;
        },
        updatePassword: async (id, passwordHash, updatedAt) => {
            const user = users.get(id);
            const updated = { ...user, passwordHash, tokenVersion: user.tokenVersion + 1, updatedAt };
            users.set(id, updated);
            return updated;
        },
        delete: async id => {
            users.delete(id);
        },
    };
    const configuration = { getConfig: () => ({ auth: { enabled: options.enabled !== false } }) };
    // 鍵ファイルが読めない状況を再現できるよう、null も明示的に渡せるようにする
    const crypto = { getSigningKey: () => ('signingKey' in options ? options.signingKey : 'test-signing-key') };
    return { model: new AuthModel(configuration, db, crypto), users };
}

test('the first user can be created and is logged in immediately', async () => {
    const { model } = authFixture();
    const before = await model.getStatus(null);
    assert.deepEqual(before, { enabled: true, initialized: false, user: null });

    const result = await model.setup('admin', 'password123');
    assert.equal(result.user.name, 'admin');
    const status = await model.getStatus(result.token);
    assert.equal(status.initialized, true);
    assert.equal(status.user.name, 'admin');
});

test('setup is refused once a user exists (it is reachable without a session)', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    await assert.rejects(() => model.setup('intruder', 'password123'), /AuthIsAlreadyInitialized/);
});

test('login fails identically for an unknown user and a wrong password', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    await assert.rejects(() => model.login('admin', 'wrong-password'), /InvalidCredentials/);
    await assert.rejects(() => model.login('nobody', 'password123'), /InvalidCredentials/);
    const result = await model.login('admin', 'password123');
    assert.equal(result.user.name, 'admin');
});

test('changing a password invalidates the sessions issued before it', async () => {
    const { model } = authFixture();
    const first = await model.setup('admin', 'password123');
    assert.notEqual(await model.verify(first.token), null);

    await model.changePassword(1, 'newpassword123', 'password123');
    assert.equal(await model.verify(first.token), null);

    const second = await model.login('admin', 'newpassword123');
    assert.notEqual(await model.verify(second.token), null);
});

test('changing your own password requires the current one', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    await assert.rejects(() => model.changePassword(1, 'newpassword123', 'wrong'), /InvalidCredentials/);
    // 現在のパスワードを渡さない場合 (管理者による他ユーザーの変更) は検証しない
    await model.changePassword(1, 'newpassword123');
});

test('user names must be unique and the last user can not be removed', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    await assert.rejects(() => model.addUser('admin', 'password123'), /UserNameIsAlreadyUsed/);
    await assert.rejects(() => model.removeUser(1), /LastUserCanNotBeRemoved/);

    const second = await model.addUser('viewer', 'password123');
    await model.removeUser(second.id);
    assert.equal((await model.listUsers()).length, 1);
});

test('a deleted user can no longer use their session', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    const viewer = await model.addUser('viewer', 'password123');
    const login = await model.login('viewer', 'password123');
    assert.notEqual(await model.verify(login.token), null);

    await model.removeUser(viewer.id);
    assert.equal(await model.verify(login.token), null);
});

test('everything is inert while auth is disabled in config.yml', async () => {
    const { model } = authFixture({ enabled: false });
    assert.equal(model.isEnabled(), false);
    assert.deepEqual(await model.getStatus(null), { enabled: false, initialized: true, user: null });
    await assert.rejects(() => model.login('admin', 'password123'), /AuthIsDisabled/);
    await assert.rejects(() => model.setup('admin', 'password123'), /AuthIsDisabled/);
});

test('sessions can not be issued or verified without a signing key', async () => {
    const { model } = authFixture({ signingKey: null });
    await assert.rejects(() => model.setup('admin', 'password123'), /SigningKeyIsNotAvailable/);
    assert.equal(await model.verify('anything'), null);
});
