'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ExecutionManagementModel = require('../../dist/model/ExecutionManagementModel').default;
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;
const EncodeManageModel = require('../../dist/model/service/encode/EncodeManageModel').default;

const system = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} };
const logger = { getLogger: () => ({ system: system }) };
const encodeLogger = { getLogger: () => ({ system: system, encode: system }) };

function createModel(
    findRule = async () => {
        throw new Error('rule db failed');
    },
) {
    const execution = new ExecutionManagementModel(logger);
    const reserveDB = { findId: async () => null, findRuleId: async () => [] };
    const ruleDB = { findId: findRule };
    const model = new ReservationManageModel(
        logger,
        { getConfig: () => ({}) },
        execution,
        { checkEncodeOption: () => false },
        reserveDB,
        {},
        {},
        ruleDB,
        { emitUpdated: () => {} },
    );
    return { model: model, execution: execution };
}

test('edit の例外後も次の実行権をすぐ取得できる', async () => {
    const { model, execution } = createModel();
    await assert.rejects(model.edit(1, { encodeOption: {} }), /ReservationEditError/);
    const id = await execution.getExecution(0, 50);
    assert.equal(typeof id, 'string');
    execution.unLockExecution(id);
});

test('手動予約編集で録画後コマンドを保存する', async () => {
    const reserve = {
        id: 1,
        priority: 3,
        startMarginSec: null,
        endMarginSec: null,
        finishCommandName: 'old',
        saveOption: null,
        encodeMode1: null,
        startAt: Date.now() + 60_000,
        endAt: Date.now() + 120_000,
    };
    const logger = { getLogger: () => ({ system }) };
    const reserveDB = {
        findId: async () => reserve,
        updateOnce: async value => {
            Object.assign(reserve, value);
        },
        findTimeRanges: async () => [],
    };
    const execution = new ExecutionManagementModel(logger);
    const model = new ReservationManageModel(
        logger,
        { getConfig: () => ({ reservation: { scheduler: 'legacy' } }) },
        execution,
        { checkEncodeOption: () => true },
        reserveDB,
        {},
        {},
        {},
        { emitUpdated: () => {} },
    );
    await model.edit(1, { finishCommandName: 'notify-after-recording' });
    assert.equal(reserve.finishCommandName, 'notify-after-recording');
});

test('updateRule の DB 例外後も次の実行権をすぐ取得できる', async () => {
    const { model, execution } = createModel();
    await assert.rejects(model.updateRule(1), /rule db failed/);
    const id = await execution.getExecution(0, 50);
    assert.equal(typeof id, 'string');
    execution.unLockExecution(id);
});

test('RuleSearchTimesOptionError の後も次の実行権をすぐ取得できる', async () => {
    const { model, execution } = createModel(async () => ({
        reserveOption: { enable: true },
        isTimeSpecification: true,
        searchOption: { keyword: 'test', channelIds: [1], times: [{ week: 127, start: 0 }] },
    }));
    await assert.rejects(model.updateRule(1), /RuleSearchTimesOptionError/);
    const id = await execution.getExecution(0, 50);
    assert.equal(typeof id, 'string');
    execution.unLockExecution(id);
});

test('時刻指定の手動予約は isEventRelay を false にする', async () => {
    const model = new ReservationManageModel(
        { getLogger: () => ({ system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }) },
        { getConfig: () => ({}) },
        {},
        {},
        { findTimeSpecification: async () => null },
        { findId: async id => ({ id: id, channel: 'test', channelType: 'GR' }) },
        {},
        {},
        {},
    );
    const reserve = await model.createManualReserveWithSpecifiedTime({
        allowEndLack: false,
        timeSpecifiedOption: { channelId: 10, name: 'manual', startAt: Date.now(), endAt: Date.now() + 60000 },
    });
    assert.equal(reserve.isEventRelay, false);
});

test('EncodeManageModel.push の provider 例外後も実行権をすぐ取得できる', async () => {
    const execution = new ExecutionManagementModel(logger);
    const model = new EncodeManageModel(
        encodeLogger,
        { getConfig: () => ({ concurrentEncodeNum: 1 }) },
        execution,
        async () => {
            throw new Error('provider failed');
        },
        { emitAddEncode: () => {} },
        { save: async () => {}, load: async () => null },
    );
    await assert.rejects(model.push({}), /provider failed/);
    const id = await execution.getExecution(0, 50);
    assert.equal(typeof id, 'string');
    execution.unLockExecution(id);
});

test('EncodeManageModel.cancel のキャンセル例外後も実行権をすぐ取得できる', async () => {
    const execution = new ExecutionManagementModel(logger);
    const model = new EncodeManageModel(
        encodeLogger,
        { getConfig: () => ({ concurrentEncodeNum: 1 }) },
        execution,
        async () => ({}),
        { emitCancelEncode: () => {} },
        { save: async () => {}, load: async () => null },
    );
    model.runningQueue = [
        {
            getEncodeId: () => 7,
            cancel: async () => {
                throw new Error('cancel failed');
            },
        },
    ];
    await assert.rejects(model.cancel(7), /cancel failed/);
    const id = await execution.getExecution(0, 50);
    assert.equal(typeof id, 'string');
    execution.unLockExecution(id);
});
