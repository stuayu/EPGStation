'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;

const noopLogger = {
    getLogger: () => ({
        system: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
    }),
};

const createModel = channelDB => {
    return new ReservationManageModel(
        noopLogger,
        { getConfig: () => ({}) },
        {}, // IExecutionManagementModel
        {}, // IReserveOptionChecker
        {}, // IReserveDB
        channelDB,
        {}, // IProgramDB
        {}, // IRuleDB
        {}, // IReserveEvent
    );
};

const enabledTypes = status => Object.keys(status).filter(key => status[key] === true);

test('チューナ情報の types が空でも登録済みチャンネルの放送波種別で補完する', async () => {
    const model = createModel({ findChannelTypeList: async () => ['GR', 'BS', 'NW17'] });
    model.setTuners([{ types: [], name: 'tuner', index: 0, command: '', isAvailable: true }]);

    assert.deepEqual(enabledTypes(await model.getBroadcastStatus()).sort(), ['BS', 'GR', 'NW17']);
});

test('チューナ情報の types が埋まっているときはチャンネル情報を参照しない', async () => {
    let called = false;
    const model = createModel({
        findChannelTypeList: async () => {
            called = true;

            return ['BS'];
        },
    });
    model.setTuners([{ types: ['GR'], name: 'tuner', index: 0, command: '', isAvailable: true }]);

    assert.deepEqual(enabledTypes(await model.getBroadcastStatus()), ['GR']);
    assert.equal(called, false);
});

test('チャンネル情報の取得が失敗してもチューナ由来の値を返す', async () => {
    const model = createModel({
        findChannelTypeList: async () => {
            throw new Error('DatabaseError');
        },
    });
    model.setTuners([{ types: [], name: 'tuner', index: 0, command: '', isAvailable: true }]);

    assert.deepEqual(enabledTypes(await model.getBroadcastStatus()), []);
});

test('チャンネル情報の取得が待ち時間を超えても応答を返し、完了後は補完済みの値を返す', async t => {
    let resolveQuery;
    const model = createModel({
        findChannelTypeList: () =>
            new Promise(resolve => {
                resolveQuery = resolve;
            }),
    });
    model.setTuners([{ types: [], name: 'tuner', index: 0, command: '', isAvailable: true }]);

    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = model.getBroadcastStatus();
    t.mock.timers.tick(3000);

    // 待ち時間を超えた 1 回目はチューナ由来の値 (全て false) を返す
    assert.deepEqual(enabledTypes(await pending), []);

    // 取得が終わったあとは補完済みの値を返す
    resolveQuery(['GR', 'CS']);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(enabledTypes(await model.getBroadcastStatus()).sort(), ['CS', 'GR']);
});
