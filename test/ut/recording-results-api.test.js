'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordingSessionApiModel = require('../../dist/model/api/recorded/RecordingSessionApiModel').default;
const RecordingSessionDB = require('../../dist/model/db/RecordingSessionDB').default;

const sample = {
    id: 3,
    reserveId: 8,
    recordedId: null,
    programId: 55,
    channelId: 7,
    state: 'FINISHED',
    scheduledStartAt: 100,
    scheduledEndAt: 200,
    actualStartAt: null,
    actualEndAt: 190,
    startReason: null,
    endReason: 'tuner-open-failed',
    resultStatus: 'failed',
    retryCount: 2,
    createdAt: 90,
    updatedAt: 190,
    name: 'テスト番組',
    channelName: '局A',
    ruleId: 9,
    isTimeSpecified: false,
};

test('録画結果一覧は絞り込み条件とページ情報を DB へ渡す', async () => {
    let received;
    const db = {
        findRecordingResults: async query => {
            received = query;
            return { items: [sample], total: 21 };
        },
    };
    const model = new RecordingSessionApiModel(db);
    const result = await model.getRecordingResults({
        result: 'failed',
        from: 10,
        to: 500,
        ruleId: 9,
        keyword: 'テスト',
        offset: 20,
        limit: 10,
    });
    assert.deepEqual(received, {
        result: 'failed',
        from: 10,
        to: 500,
        ruleId: 9,
        keyword: 'テスト',
        offset: 20,
        limit: 10,
    });
    assert.equal(result.total, 21);
    assert.equal(result.items[0].name, 'テスト番組');
    assert.equal(result.items[0].recordedId, undefined);
});

test('録画結果詳細はセッションに対応する attempt を返す', async () => {
    const attempt = {
        id: 4,
        sessionId: 3,
        attemptNo: 1,
        requestedAt: 110,
        firstDataAt: null,
        endedAt: 120,
        closeReason: '503',
        errorCode: null,
        priority: 0,
        bytesReceived: 0,
        fileOffsetStart: null,
        fileOffsetEnd: null,
    };
    const model = new RecordingSessionApiModel({
        findById: async id => (id === 3 ? sample : null),
        findAttemptsBySessionId: async id => (id === 3 ? [attempt] : []),
    });
    const result = await model.getRecordingResultDetail(3);
    assert.equal(result.session.id, 3);
    assert.equal(result.attempts[0].attemptNo, 1);
    assert.equal(result.attempts[0].errorCode, '');
    assert.equal(await model.getRecordingResultDetail(99), null);
});

test('録画結果 DB は全条件で絞り込み、予定時刻降順でページングする', async () => {
    const calls = [];
    const qb = {
        andWhere: (...args) => {
            calls.push(['where', ...args]);
            return qb;
        },
        orderBy: (...args) => {
            calls.push(['order', ...args]);
            return qb;
        },
        addOrderBy: (...args) => {
            calls.push(['addOrder', ...args]);
            return qb;
        },
        skip: value => {
            calls.push(['skip', value]);
            return qb;
        },
        take: value => {
            calls.push(['take', value]);
            return qb;
        },
        getManyAndCount: async () => [[sample], 1],
    };
    const op = {
        getConnection: async () => ({ getRepository: () => ({ createQueryBuilder: () => qb }) }),
        getLikeStr: () => 'LIKE',
    };
    const db = new RecordingSessionDB(op, { run: fn => fn() });
    const result = await db.findRecordingResults({
        result: 'failed',
        from: 10,
        to: 500,
        ruleId: 9,
        keyword: '番組',
        offset: 5,
        limit: 10,
    });
    assert.equal(result.total, 1);
    assert.deepEqual(
        calls.filter(call => call[0] === 'where').map(call => call[1]),
        [
            'session.resultStatus = :result',
            'session.scheduledStartAt >= :from',
            'session.scheduledStartAt <= :to',
            'session.ruleId = :ruleId',
            'session.name LIKE :keyword',
        ],
    );
    assert.deepEqual(calls.slice(-4), [
        ['order', 'session.scheduledStartAt', 'DESC'],
        ['addOrder', 'session.id', 'DESC'],
        ['skip', 5],
        ['take', 10],
    ]);
});

test('結果を指定しない一覧は完了前のセッションを含めない', async () => {
    const calls = [];
    const qb = {
        andWhere: (...args) => {
            calls.push(args);
            return qb;
        },
        orderBy: () => qb,
        addOrderBy: () => qb,
        skip: () => qb,
        take: () => qb,
        getManyAndCount: async () => [[], 0],
    };
    const op = {
        getConnection: async () => ({ getRepository: () => ({ createQueryBuilder: () => qb }) }),
    };
    const db = new RecordingSessionDB(op, { run: fn => fn() });
    await db.findRecordingResults({ offset: 0, limit: 10 });
    assert.deepEqual(calls, [['session.resultStatus IS NOT NULL']]);
});
