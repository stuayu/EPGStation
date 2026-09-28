'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ProgramDB = require('../../dist/model/db/ProgramDB').default;
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;

const ID = 1000001;
const START = 1785225000000;

function createDB() {
    const program = {
        id: ID,
        startAt: START,
        endAt: START + 60000,
        duration: 60000,
        updateTime: 10,
        eitReceivedAt: null,
        eitStartAt: null,
        eitEndAt: null,
        eitDurationUndefined: false,
    };
    const updates = [];
    const repository = {
        findOne: async () => ({ ...program }),
        update: async (_id, value) => {
            updates.push(value);
            Object.assign(program, value);
        },
    };
    const connection = { getRepository: () => repository };
    const logger = { getLogger: () => ({ system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }) };
    const db = new ProgramDB(logger, { getConfig: () => ({}) }, { getConnection: async () => connection }, {});
    return { db: db, program: program, updates: updates };
}

test('EIT 時刻・duration が変わった場合だけ updateTime を進め、duration は ms で保存する', async t => {
    const { db, program, updates } = createDB();
    const nextStart = START + 5000;

    const updated = await db.applyEitProgram(10, {
        eventId: 1,
        startAt: nextStart,
        durationSec: 120,
        receivedAt: START,
        isFollowing: false,
    });

    assert.equal(program.duration, 120000);
    assert.equal(program.endAt, nextStart + 120000);
    assert.ok(program.updateTime > 10);
    assert.equal(updated.updateTime, program.updateTime);
    assert.equal(updates[0].duration, 120000);
    const updateTime = program.updateTime;

    await db.applyEitProgram(10, {
        eventId: 1,
        startAt: nextStart,
        durationSec: 120,
        receivedAt: START + 10000,
        isFollowing: false,
    });
    assert.equal(program.updateTime, updateTime);
    assert.equal(Object.hasOwn(updates[1], 'updateTime'), false);
    t.diagnostic(JSON.stringify({ updateTimeBefore: 10, updateTimeAfter: updateTime, eventDurationSec: 120, oldStoredDuration: 120, durationAfter: program.duration }));
});

test('EIT 更新から予約 update へ進み、変更なしの早期 return を避ける', async () => {
    const { db, program } = createDB();
    const reserve = {
        id: 5,
        programId: ID,
        programUpdateTime: 10,
        updateTime: 20,
        startAt: START,
        endAt: START + 60000,
        channelId: 10,
        channel: 'test',
        channelType: 'GR',
        ruleId: null,
        ruleUpdateCnt: null,
        isSkip: false,
        isConflict: false,
        isOverlap: false,
        isEventRelay: false,
    };
    const updates = [];
    const reserveDB = {
        findProgramIds: async () => [reserve],
        findId: async () => ({ ...reserve }),
        findTimeRanges: async () => [],
        updateMany: async diff => updates.push(diff),
    };
    const logger = { getLogger: () => ({ system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }) };
    const execution = { getExecution: async () => 'lock', unLockExecution: () => {} };
    const model = new ReservationManageModel(
        logger,
        { getConfig: () => ({}) },
        execution,
        {},
        reserveDB,
        {},
        { findId: async () => program },
        {},
        { emitUpdated: () => {} },
    );
    await db.applyEitProgram(10, {
        eventId: 1,
        startAt: START + 1000,
        durationSec: 120,
        receivedAt: START,
        isFollowing: false,
    });

    await model.updateReservesByProgramIds([ID]);

    assert.equal(updates.length, 1);
    assert.equal(updates[0].update.length, 1);
    assert.ok(updates[0].update[0].programUpdateTime > reserve.programUpdateTime);
});

test('鮮度内の EIT 上書きでも duration を ms で保持する', async () => {
    const { db, program } = createDB();
    program.eitReceivedAt = Date.now();
    program.eitStartAt = START;
    program.eitEndAt = START + 120000;
    const values = [{ id: ID }];

    await db.applyFreshEitOverrides(values);

    assert.equal(values[0].duration, 120000);
});
