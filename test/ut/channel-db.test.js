'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ChannelDB = require('../../dist/model/db/ChannelDB').default;

/**
 * ChannelDB.ts (TypeORM Repository をラップした DB 層) を検証するための最小限のインメモリ TypeORM 互換フェイク
 * insert() は queryRunner.manager.insert / update / delete のみを使うため、それらだけを実装する
 */
function makeStore() {
    return new Map();
}

function makeConnection(store) {
    return {
        createQueryRunner: () => ({
            manager: {
                insert: async (_Entity, item) => {
                    if (store.has(item.id)) {
                        throw new Error('already exists');
                    }
                    store.set(item.id, { ...item });
                },
                update: async (_Entity, id, item) => {
                    if (!store.has(id)) {
                        throw new Error('not found');
                    }
                    store.set(id, { ...store.get(id), ...item });
                },
                delete: async (_Entity, id) => {
                    store.delete(id);
                },
            },
            startTransaction: async () => {},
            commitTransaction: async () => {},
            rollbackTransaction: async () => {},
            release: async () => {},
        }),
    };
}

function makeLogger() {
    const calls = { warn: [], error: [], debug: [], info: [] };
    const system = {
        warn: (...args) => calls.warn.push(args),
        error: (...args) => calls.error.push(args),
        debug: (...args) => calls.debug.push(args),
        info: (...args) => calls.info.push(args),
    };
    return {
        loggerModel: { getLogger: () => ({ system, access: system, stream: system, encode: system }) },
        calls,
    };
}

function makeDB() {
    const store = makeStore();
    const connection = makeConnection(store);
    const op = { getConnection: async () => connection };
    const { loggerModel, calls } = makeLogger();
    const configuration = { getConfig: () => ({}) };
    const promiseRetry = { run: job => job() };
    const db = new ChannelDB(loggerModel, configuration, op, promiseRetry);
    return { db, store, calls };
}

function baseService(overrides = {}) {
    return {
        id: 1,
        serviceId: 101,
        networkId: 1,
        name: 'test channel',
        type: 1,
        hasLogoData: false,
        ...overrides,
    };
}

test('insert: channel が配列のとき従来どおり 0 番目が使われる', async () => {
    const { db, store } = makeDB();
    await db.insert([
        baseService({
            channel: [
                { type: 'GR', channel: '27' },
                { type: 'BS', channel: '99' },
            ],
        }),
    ]);

    const row = store.get(1);
    assert.ok(row);
    assert.equal(row.channelType, 'GR');
    assert.equal(row.channel, '27');
});

test('insert: channel が単一オブジェクトのとき正しく取り込まれる (本家 Mirakurun 互換)', async () => {
    const { db, store } = makeDB();
    await db.insert([
        baseService({
            channel: { type: 'GR', channel: '27' },
        }),
    ]);

    const row = store.get(1);
    assert.ok(row);
    assert.equal(row.channelType, 'GR');
    assert.equal(row.channel, '27');
});

test('insert: channel が undefined のサービスは skip され、他のサービスは登録される', async () => {
    const { db, store, calls } = makeDB();
    await db.insert([
        baseService({ id: 1, channel: undefined }),
        baseService({ id: 2, channel: { type: 'BS', channel: '101' } }),
    ]);

    assert.equal(store.has(1), false);
    assert.ok(store.has(2));
    assert.equal(calls.warn.length, 1);
});

test('insert: 1 件の変換で例外が起きても残りのサービスは登録される', async () => {
    const { db, store, calls } = makeDB();
    // getChannelTypeId は未知の type でも default(44) を返すため例外にならない。
    // 変換時に例外を起こすため、意図的に name に対して toDBStr が扱えない型を渡す。
    const brokenService = baseService({ id: 1, channel: { type: 'GR', channel: '1' } });
    Object.defineProperty(brokenService, 'name', {
        get() {
            throw new Error('boom');
        },
    });

    await db.insert([brokenService, baseService({ id: 2, channel: { type: 'BS', channel: '101' } })]);

    assert.equal(store.has(1), false);
    assert.ok(store.has(2));
    assert.equal(calls.error.length, 1);
    assert.match(calls.error[0][0], /Failed to create insert values for 1 channels/);
});
