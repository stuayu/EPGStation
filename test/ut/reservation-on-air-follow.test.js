'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;

const NOOP_LOGGER = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} },
    }),
};

/**
 * updateOnAirReserves だけを動かすための最小構成を作る
 * @param reserves findTimeRanges が返す予約
 * @return { model, findTimeRangesOptions, updatedIds }
 */
const createModel = reserves => {
    const findTimeRangesOptions = [];
    const reserveDB = {
        findTimeRanges: async option => {
            findTimeRangesOptions.push(option);

            return reserves;
        },
    };

    const model = new ReservationManageModel(
        NOOP_LOGGER,
        { getConfig: () => ({}) },
        {},
        {},
        reserveDB,
        {},
        {},
        {},
        {},
    );

    const updatedIds = [];
    model.update = async reserveId => {
        updatedIds.push(reserveId);
    };

    return { model, findTimeRangesOptions, updatedIds };
};

test('EIT[p/f] の更新があった放送局の programId 予約だけを即時に追従させる', async () => {
    const { model, updatedIds } = createModel([
        { id: 1, channelId: 3273601024, programId: 100 },
        // 別の放送局の予約は対象外
        { id: 2, channelId: 3273701024, programId: 200 },
        // 時刻指定予約 (番組情報を持たない) は対象外
        { id: 3, channelId: 3273601024, programId: null },
    ]);

    await model.updateOnAirReserves([3273601024]);

    assert.deepEqual(updatedIds, [1]);
});

test('放送局が空なら予約を引きに行かない', async () => {
    const { model, findTimeRangesOptions, updatedIds } = createModel([{ id: 1, channelId: 1, programId: 100 }]);

    await model.updateOnAirReserves([]);

    assert.equal(findTimeRangesOptions.length, 0);
    assert.deepEqual(updatedIds, []);
});

test('現在時刻から 15 分先までに重なる予約を対象にする', async () => {
    const { model, findTimeRangesOptions } = createModel([]);
    const before = new Date().getTime();

    await model.updateOnAirReserves([1]);

    assert.equal(findTimeRangesOptions.length, 1);
    const time = findTimeRangesOptions[0].times[0];
    assert.ok(time.startAt >= before);
    assert.equal(time.endAt - time.startAt, 15 * 60 * 1000);
    // スキップ済みの予約は追従させない
    assert.equal(findTimeRangesOptions[0].hasSkip, false);
});

test('1 件の更新が失敗しても残りの予約の追従は続ける', async () => {
    const { model, updatedIds } = createModel([
        { id: 1, channelId: 1, programId: 100 },
        { id: 2, channelId: 1, programId: 200 },
    ]);

    model.update = async reserveId => {
        if (reserveId === 1) {
            throw new Error('UpdateError');
        }
        updatedIds.push(reserveId);
    };

    await model.updateOnAirReserves([1]);

    assert.deepEqual(updatedIds, [2]);
});
