'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { hashPassword, verifyPassword, assertValidPassword } = require('../../dist/model/auth/PasswordHash');
const { createSessionToken, verifySessionToken, readCookie } = require('../../dist/model/auth/SessionToken');
const { isAdminApiPath, isMediaApiPath, isPublicApiPath, toApiPath } = require('../../dist/model/auth/AuthGuard');
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
    const payload = { uid: 1, name: 'admin', role: 'admin', exp: Date.now() + 1000, ver: 3 };
    const token = createSessionToken(payload, 'secret');
    assert.deepEqual(verifySessionToken(token, 'secret'), payload);
});

test('session tokens are rejected when tampered with, expired or signed by another key', () => {
    const token = createSessionToken({ uid: 1, name: 'admin', role: 'admin', exp: Date.now() + 1000, ver: 1 }, 'secret');
    assert.equal(verifySessionToken(token, 'another-secret'), null);
    // 署名を 1 文字書き換える
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    assert.equal(verifySessionToken(tampered, 'secret'), null);
    // 本文だけ差し替えても署名が合わない
    const forged = `${Buffer.from(JSON.stringify({ uid: 2, name: 'x', role: 'admin', exp: Date.now() + 1000, ver: 1 })).toString('base64url')}.${token.split('.')[1]}`;
    assert.equal(verifySessionToken(forged, 'secret'), null);

    const expired = createSessionToken({ uid: 1, name: 'admin', role: 'admin', exp: Date.now() - 1, ver: 1 }, 'secret');
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

test('the SSO redirect and callback must be reachable without a session', () => {
    // ここが 401 になると、ログイン前に通る経路が塞がれて SSO ログインが一切できない
    for (const path of [
        '/auth/oauth/google',
        '/auth/oauth/google/callback',
        '/auth/oauth/github',
        '/auth/oauth/github/callback',
    ]) {
        assert.equal(isPublicApiPath(path), true, path);
    }
    // 接頭辞が似ているだけの管理 API を巻き込まないこと
    assert.equal(isPublicApiPath('/auth/users'), false);
    assert.equal(isPublicApiPath('/auth/oauthevil'), false);
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
    const identities = [];
    let nextId = 1;
    let nextIdentityId = 1;
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
            for (let i = identities.length - 1; i >= 0; i--) {
                if (identities[i].userId === id) identities.splice(i, 1);
            }
        },
        updateRole: async (id, role, updatedAt) => {
            const updated = { ...users.get(id), role, updatedAt };
            users.set(id, updated);
            return updated;
        },
        countByRole: async role => [...users.values()].filter(u => u.role === role).length,
        findIdentity: async (provider, providerUserId) =>
            identities.find(x => x.provider === provider && x.providerUserId === providerUserId) ?? null,
        listIdentities: async userId => identities.filter(x => x.userId === userId),
        upsertIdentity: async value => {
            const current = identities.find(
                x => x.provider === value.provider && x.providerUserId === value.providerUserId,
            );
            if (typeof current !== 'undefined') {
                Object.assign(current, value);
                return current;
            }
            const created = { ...value, id: nextIdentityId++ };
            identities.push(created);
            return created;
        },
    };
    const configuration = {
        getConfig: () => ({
            auth: {
                enabled: options.enabled !== false,
                allowSignUp: options.allowSignUp,
                allowAnonymous: options.allowAnonymous,
            },
        }),
    };
    // 実装と同じく用途ごとに違う鍵を返す (セッションとメディア用トークンを取り違えないため)。
    // 鍵ファイルが読めない状況を再現できるよう、null も明示的に渡せるようにする
    const crypto = {
        getSigningKey: purpose => ('signingKey' in options ? options.signingKey : `test-signing-key:${purpose}`),
    };
    return { model: new AuthModel(configuration, db, crypto), users, identities };
}

test('the first user can be created and is logged in immediately', async () => {
    const { model } = authFixture();
    const before = await model.getStatus(null);
    assert.equal(before.initialized, false);
    assert.equal(before.user, null);

    const result = await model.setup('admin', 'password123');
    assert.equal(result.user.name, 'admin');
    // 最初のユーザーは必ずシステム管理者になる
    assert.equal(result.user.role, 'admin');
    const status = await model.getStatus(result.token);
    assert.equal(status.initialized, true);
    assert.equal(status.user.name, 'admin');
    assert.equal(status.user.role, 'admin');
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
    // 管理者が作ったユーザーは一般権限
    assert.equal(second.role, 'user');
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

test('authentication is enabled unless config.yml turns it off', async () => {
    // 未指定は有効 (opt-out)
    const configuration = { getConfig: () => ({}) };
    const enabled = new AuthModel(configuration, { count: async () => 0 }, { getSigningKey: () => 'k' });
    assert.equal(enabled.isEnabled(), true);

    const withEmptyAuth = new AuthModel({ getConfig: () => ({ auth: {} }) }, { count: async () => 0 }, { getSigningKey: () => 'k' });
    assert.equal(withEmptyAuth.isEnabled(), true);
});

test('anonymous access is allowed unless config.yml turns it off', async () => {
    // 未指定は許可 (opt-out)。日常操作はログイン不要のまま、管理者向け操作だけを保護する
    assert.equal(authFixture().model.isAnonymousAllowed(), true);
    assert.equal(authFixture({ allowAnonymous: false }).model.isAnonymousAllowed(), false);
    // 認証自体が無効なら「匿名許可」も false (画面側の分岐を単純にするため)
    assert.equal(authFixture({ enabled: false }).model.isAnonymousAllowed(), false);
});

test('the anonymous setting is reported to the client', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    const status = await model.getStatus(null);
    assert.equal(status.allowAnonymous, true);
    // 未ログインなので user は null のまま
    assert.equal(status.user, null);
});

test('anonymous users must never reach the admin only endpoints', () => {
    // 匿名許可でも、この一覧に載っているパスはログイン + 管理者権限が要る
    for (const path of ['/settings/system', '/settings/config', '/auth/users', '/update/run', '/logs']) {
        assert.equal(isAdminApiPath(path), true, path);
    }
    // 閲覧・予約などは匿名でも通す対象
    for (const path of ['/recorded', '/reserves', '/schedules', '/videos/1', '/streams/live/1/m2ts']) {
        assert.equal(isAdminApiPath(path), false, path);
    }
});

test('media tokens let external players through without a cookie', async () => {
    const { model } = authFixture();
    const login = await model.setup('admin', 'password123');
    const session = await model.verify(login.token);

    const mediaToken = model.createMediaToken(session);
    assert.notEqual(mediaToken, null);
    // メディア用トークンとして検証できる
    assert.equal((await model.verifyMediaToken(mediaToken)).uid, session.uid);
    // セッションとは鍵が違うので取り違えられない
    assert.equal(await model.verify(mediaToken), null);
    assert.equal(await model.verifyMediaToken(login.token), null);
});

test('media tokens are invalidated by a password change', async () => {
    const { model } = authFixture();
    const login = await model.setup('admin', 'password123');
    const mediaToken = model.createMediaToken(await model.verify(login.token));
    assert.notEqual(await model.verifyMediaToken(mediaToken), null);

    await model.changePassword(1, 'newpassword123', 'password123');
    assert.equal(await model.verifyMediaToken(mediaToken), null);
});

test('only the media endpoints accept a token in the query', () => {
    // 外部プレイヤー・IPTV クライアントは Cookie を送れない
    for (const path of ['/videos/1', '/videos/1/playlist', '/iptv/channel.m3u8', '/streams/live/1/m2ts', '/recorded/1/thumbnail']) {
        assert.equal(isMediaApiPath(path), true, path);
    }
    // 設定変更などをトークンで叩けてしまわないこと
    for (const path of ['/settings/system', '/auth/users', '/reserves', '/rules', '/videosxyz']) {
        assert.equal(isMediaApiPath(path), false, path);
    }
});

test('everything is inert while auth is disabled in config.yml', async () => {
    const { model } = authFixture({ enabled: false });
    assert.equal(model.isEnabled(), false);
    const status = await model.getStatus(null);
    assert.equal(status.enabled, false);
    assert.equal(status.user, null);
    await assert.rejects(() => model.login('admin', 'password123'), /AuthIsDisabled/);
    await assert.rejects(() => model.setup('admin', 'password123'), /AuthIsDisabled/);
});

test('sessions can not be issued or verified without a signing key', async () => {
    const { model } = authFixture({ signingKey: null });
    await assert.rejects(() => model.setup('admin', 'password123'), /SigningKeyIsNotAvailable/);
    assert.equal(await model.verify('anything'), null);
});

// --- 権限 (システム管理者 / 一般) ---

test('admin only endpoints are separated from the ones every user may call', () => {
    for (const path of ['/settings', '/settings/system', '/auth/users', '/auth/users/1/role', '/update', '/update/run', '/logs']) {
        assert.equal(isAdminApiPath(path), true, path);
    }
    // 視聴・録画閲覧など一般ユーザーが使う API は管理者限定にしない
    for (const path of ['/recorded', '/reserves', '/schedules', '/auth', '/auth/login', '/streams', ''] ) {
        assert.equal(isAdminApiPath(path), false, path);
    }
});

test('an admin can promote and demote others but not remove the last admin', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    const viewer = await model.addUser('viewer', 'password123');
    assert.equal(viewer.role, 'user');

    await model.setRole(viewer.id, 'admin');
    assert.equal((await model.listUsers()).find(u => u.id === viewer.id).role, 'admin');

    await model.setRole(viewer.id, 'user');
    assert.equal((await model.listUsers()).find(u => u.id === viewer.id).role, 'user');

    // 管理者が居なくなる操作は止める
    await assert.rejects(() => model.setRole(1, 'user'), /LastAdminCanNotBeDemoted/);
    await assert.rejects(() => model.removeUser(1), /LastAdminCanNotBeRemoved/);
    await assert.rejects(() => model.setRole(1, 'superuser'), /InvalidRole/);
});

test('a role change takes effect without re-login', async () => {
    const { model } = authFixture();
    await model.setup('admin', 'password123');
    const viewer = await model.addUser('viewer', 'password123');
    const login = await model.login('viewer', 'password123');
    assert.equal((await model.verify(login.token)).role, 'user');

    await model.setRole(viewer.id, 'admin');
    // トークンは古い権限を持ったままだが、検証時に DB の現在値で上書きされる
    assert.equal((await model.verify(login.token)).role, 'admin');
});

// --- SSO (Google / GitHub) ---

const googleProfile = { provider: 'google', providerUserId: '1001', email: 'owner@example.com', name: 'Owner' };

test('the first SSO sign up becomes the system administrator', async () => {
    const { model } = authFixture();
    const result = await model.signInWithProvider(googleProfile);
    assert.equal(result.user.role, 'admin');
    assert.equal(result.user.name, 'Owner');
});

test('later SSO sign ups get the general role', async () => {
    const { model } = authFixture();
    await model.signInWithProvider(googleProfile);
    const second = await model.signInWithProvider({
        provider: 'github',
        providerUserId: '2002',
        email: 'member@example.com',
        name: 'member',
    });
    assert.equal(second.user.role, 'user');
    assert.equal((await model.listUsers()).length, 2);
});

test('signing in again with the same provider account reuses the user', async () => {
    const { model } = authFixture();
    const first = await model.signInWithProvider(googleProfile);
    const again = await model.signInWithProvider({ ...googleProfile, email: 'changed@example.com' });
    assert.equal(again.user.id, first.user.id);
    assert.equal((await model.listUsers()).length, 1);
});

test('SSO users can not log in with a password', async () => {
    const { model } = authFixture();
    await model.signInWithProvider(googleProfile);
    await assert.rejects(() => model.login('Owner', ''), /InvalidCredentials/);
    await assert.rejects(() => model.login('Owner', 'password123'), /InvalidCredentials/);
});

test('a display name collision is resolved instead of failing the sign in', async () => {
    const { model } = authFixture();
    await model.setup('Owner', 'password123');
    const sso = await model.signInWithProvider(googleProfile);
    assert.equal(sso.user.name, 'Owner (google)');
});

test('sign up can be closed to everyone but the existing users', async () => {
    const { model } = authFixture({ allowSignUp: false });
    // 1 人目は許可される (誰も居ないと管理者を作れないため)
    await model.signInWithProvider(googleProfile);
    await assert.rejects(
        () => model.signInWithProvider({ provider: 'github', providerUserId: '2', email: null, name: 'x' }),
        /SignUpIsNotAllowed/,
    );
    // すでに紐付いているアカウントはログインできる
    await model.signInWithProvider(googleProfile);
});

test('the linked providers are visible in the user list', async () => {
    const { model } = authFixture();
    await model.signInWithProvider(googleProfile);
    const users = await model.listUsers();
    assert.deepEqual(users[0].providers, ['google']);
    // SSO だけのユーザーはパスワードを持たない
    assert.equal(users[0].hasPassword, false);
});
