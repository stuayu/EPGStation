'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const MisskeyAuthSessionStore = require('../../dist/model/sns/MisskeyAuthSessionStore').default;

const NOW = 1785225000000;
const MINUTE = 60 * 1000;

test('作成直後のセッションは取得できる', () => {
    const store = new MisskeyAuthSessionStore();
    store.create('session-1', 'misskey.io', 10, NOW);
    const session = store.get('session-1', NOW);
    assert.notEqual(session, null);
    assert.equal(session.host, 'misskey.io');
    assert.equal(session.userId, 10);
});

test('TTL (10 分) を超えたセッションは取得できない', () => {
    const store = new MisskeyAuthSessionStore();
    store.create('session-1', 'misskey.io', null, NOW);
    const stillValid = store.get('session-1', NOW + 9 * MINUTE);
    assert.notEqual(stillValid, null);
    const expired = store.get('session-1', NOW + 11 * MINUTE);
    assert.equal(expired, null);
});

test('get() は期限切れセッションを掃除する (メモリリークを防ぐ)', () => {
    const store = new MisskeyAuthSessionStore();
    store.create('session-1', 'misskey.io', null, NOW);
    store.create('session-2', 'misskey.io', null, NOW);
    assert.equal(store.size(), 2);
    // session-1 だけ問い合わせても、掃除は全件に対して走る
    store.get('session-1', NOW + 11 * MINUTE);
    assert.equal(store.size(), 0);
});

test('create() のたびにも期限切れセッションを掃除する', () => {
    const store = new MisskeyAuthSessionStore();
    store.create('session-1', 'misskey.io', null, NOW);
    store.create('session-2', 'misskey.io', null, NOW + 11 * MINUTE);
    // session-1 は session-2 作成時点で期限切れなので掃除され、残るのは session-2 のみ
    assert.equal(store.size(), 1);
    assert.equal(store.get('session-1', NOW + 11 * MINUTE), null);
    assert.notEqual(store.get('session-2', NOW + 11 * MINUTE), null);
});

test('remove() で明示的に削除できる (認証完了後の後始末)', () => {
    const store = new MisskeyAuthSessionStore();
    store.create('session-1', 'misskey.io', null, NOW);
    store.remove('session-1');
    assert.equal(store.get('session-1', NOW), null);
    assert.equal(store.size(), 0);
});
