'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { getRequestUserId } = require('../../dist/model/auth/RequestUser');
const { SESSION_COOKIE_NAME } = require('../../dist/model/auth/SessionCookie');

const makeAuthModel = ({ enabled, verifyResult }) => ({
    isEnabled: () => enabled,
    verify: async () => verifyResult,
});

test('認証が無効なら Cookie を見ずに null (共有枠) を返す', async () => {
    const authModel = makeAuthModel({ enabled: false, verifyResult: { uid: 999 } });
    const req = { headers: {} };
    const userId = await getRequestUserId(req, authModel);
    assert.equal(userId, null);
});

test('認証が有効で Cookie が無ければ null を返す', async () => {
    const authModel = makeAuthModel({ enabled: true, verifyResult: null });
    const req = { headers: {} };
    const userId = await getRequestUserId(req, authModel);
    assert.equal(userId, null);
});

test('認証が有効で有効な Cookie があればトークンを検証しユーザー id を返す', async () => {
    const authModel = makeAuthModel({ enabled: true, verifyResult: { uid: 42 } });
    const req = { headers: { cookie: `${SESSION_COOKIE_NAME}=some-token` } };
    const userId = await getRequestUserId(req, authModel);
    assert.equal(userId, 42);
});

test('トークンの検証に失敗した場合 (verify が null を返す) は null を返す', async () => {
    const authModel = makeAuthModel({ enabled: true, verifyResult: null });
    const req = { headers: { cookie: `${SESSION_COOKIE_NAME}=invalid-token` } };
    const userId = await getRequestUserId(req, authModel);
    assert.equal(userId, null);
});
