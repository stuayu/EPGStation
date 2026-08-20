'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ProgramDB = require('../../dist/model/db/ProgramDB').default;

/**
 * ProgramDB.insert() の削除・挿入だけを見るための最小限の TypeORM 互換フェイク。
 * insert() は
 *   - queryRunner.manager.createQueryBuilder().delete().from(Program).where()/orWhere().execute()
 *   - queryRunner.manager.delete(Program, criteria)
 *   - queryRunner.manager.insert(Program, value)
 * しか使わないため、それらだけを実装する
 */
function matchCondition(cond, item) {
    if (cond.str.startsWith('endAt >= :now')) {
        return item.endAt >= cond.params.now;
    }
    if (cond.str.startsWith('endAt < :threshold')) {
        return item.endAt < cond.params.threshold;
    }
    throw new Error(`unknown condition: ${cond.str}`);
}

function makeConnection(store) {
    return {
        createQueryRunner: () => ({
            manager: {
                createQueryBuilder: () => ({
                    delete: () => ({
                        from: () => {
                            const conditions = [];
                            const builder = {
                                where: (str, params) => {
                                    conditions.push({ str: str, params: params });

                                    return builder;
                                },
                                orWhere: (str, params) => {
                                    conditions.push({ str: str, params: params });

                                    return builder;
                                },
                                execute: async () => {
                                    if (conditions.length === 0) {
                                        store.clear();

                                        return;
                                    }
                                    for (const [id, item] of [...store]) {
                                        if (conditions.some(cond => matchCondition(cond, item)) === true) {
                                            store.delete(id);
                                        }
                                    }
                                },
                            };

                            return builder;
                        },
                    }),
                }),
                delete: async (_Entity, criteria) => {
                    // In() は FindOperator なので value に配列が入る
                    if (typeof criteria.id !== 'undefined') {
                        for (const id of criteria.id.value) {
                            store.delete(id);
                        }

                        return;
                    }
                    for (const [id, item] of [...store]) {
                        if (criteria.channelId.value.includes(item.channelId) === true) {
                            store.delete(id);
                        }
                    }
                },
                insert: async (_Entity, value) => {
                    if (store.has(value.id) === true) {
                        // MySQL の ER_DUP_ENTRY 相当
                        throw new Error(`Duplicate entry '${value.id}' for key 'PRIMARY'`);
                    }
                    store.set(value.id, { ...value });
                },
            },
            startTransaction: async () => {},
            commitTransaction: async () => {},
            rollbackTransaction: async () => {},
            release: async () => {},
        }),
    };
}

function makeDB() {
    const store = new Map();
    const connection = makeConnection(store);
    const system = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };
    const logger = { getLogger: () => ({ system: system, access: system, stream: system, encode: system }) };
    const configuration = { getConfig: () => ({}) };
    const op = { getConnection: async () => connection };
    const promiseRetry = { run: async fn => await fn() };

    return { db: new ProgramDB(logger, configuration, op, promiseRetry), store: store };
}

const CHANNEL_TYPES = {
    32230: {
        33840: { id: 3223033840, type: 'GR', channel: '23' },
    },
};

const createProgram = (eventId, startAt, duration, name) => {
    return {
        id: 322303384000000 + eventId,
        eventId: eventId,
        serviceId: 33840,
        networkId: 32230,
        startAt: startAt,
        duration: duration,
        isFree: true,
        name: name,
    };
};

test('保存期間内に終了した番組を Mirakurun が返し続けても全件更新が失敗しない', async () => {
    const { db, store } = makeDB();
    const now = Date.now();
    // 30 分前に終了した番組 (保存期間内なので削除されずに残る)
    const finished = createProgram(1, now - 60 * 60 * 1000, 30 * 60 * 1000, '終了した番組');
    // 放送中の番組
    const onAir = createProgram(2, now - 10 * 60 * 1000, 60 * 60 * 1000, '放送中の番組');

    const keepOption = { now: now, retentionThreshold: now - 24 * 60 * 60 * 1000 };
    await db.insert(CHANNEL_TYPES, [finished, onAir], [], keepOption);
    assert.equal(store.size, 2);

    // Mirakurun は終了直後の番組もしばらく返し続けるため、同じ番組がもう一度来る
    await db.insert(CHANNEL_TYPES, [finished, onAir], [], keepOption);
    assert.equal(store.size, 2);
    assert.equal(store.get(finished.id).name, '終了した番組');
});

test('保存期間内に終了した番組は再取得されなければ残る', async () => {
    const { db, store } = makeDB();
    const now = Date.now();
    const finished = createProgram(1, now - 60 * 60 * 1000, 30 * 60 * 1000, '終了した番組');
    const onAir = createProgram(2, now - 10 * 60 * 1000, 60 * 60 * 1000, '放送中の番組');

    const keepOption = { now: now, retentionThreshold: now - 24 * 60 * 60 * 1000 };
    await db.insert(CHANNEL_TYPES, [finished, onAir], [], keepOption);

    // 2 回目は終了済みの番組が返ってこない
    await db.insert(CHANNEL_TYPES, [onAir], [], keepOption);
    assert.equal(store.size, 2);
    assert.equal(typeof store.get(finished.id) !== 'undefined', true);
});

test('保存期間を過ぎた過去番組は全件更新で削除される', async () => {
    const { db, store } = makeDB();
    const now = Date.now();
    const old = createProgram(1, now - 48 * 60 * 60 * 1000, 30 * 60 * 1000, '古い番組');
    const onAir = createProgram(2, now - 10 * 60 * 1000, 60 * 60 * 1000, '放送中の番組');

    const keepOption = { now: now, retentionThreshold: now - 24 * 60 * 60 * 1000 };
    await db.insert(CHANNEL_TYPES, [old, onAir], [], keepOption);
    // 挿入直後は保存期間より古い番組も入る
    assert.equal(store.size, 2);

    await db.insert(CHANNEL_TYPES, [onAir], [], keepOption);
    assert.equal(store.size, 1);
    assert.equal(typeof store.get(old.id), 'undefined');
});

test('keepOption 無しの全件更新は従来どおり全件削除してから挿入する', async () => {
    const { db, store } = makeDB();
    const now = Date.now();
    const finished = createProgram(1, now - 60 * 60 * 1000, 30 * 60 * 1000, '終了した番組');
    const onAir = createProgram(2, now - 10 * 60 * 1000, 60 * 60 * 1000, '放送中の番組');

    await db.insert(CHANNEL_TYPES, [finished, onAir], []);
    await db.insert(CHANNEL_TYPES, [onAir], []);

    assert.equal(store.size, 1);
    assert.equal(typeof store.get(finished.id), 'undefined');
});
