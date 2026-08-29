'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;
const Reserve = require('../../dist/db/entities/Reserve').default;

const noopLogger = {
    getLogger: () => ({
        system: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
    }),
};

/**
 * イベントリレー予約の並行処理を動かす最小構成を作る
 * @return { model, reserves, getUnlockCount }
 */
const createModel = () => {
    const reserves = [];
    let unlockCount = 0;
    let nextExecution = Promise.resolve();
    const reserveDB = {
        findProgramId: async programId => reserves.filter(reserve => reserve.programId === programId),
        findTimeRanges: async () => [],
        insertOnce: async reserve => {
            reserves.push(reserve);

            return reserves.length;
        },
    };
    const executeManagementModel = {
        getExecution: async () => {
            let unlock;
            const previous = nextExecution;
            nextExecution = new Promise(resolve => {
                unlock = resolve;
            });
            await previous;

            return { unlock };
        },
        unLockExecution: execution => {
            unlockCount++;
            execution.unlock();
        },
    };
    const model = new ReservationManageModel(
        noopLogger,
        { getConfig: () => ({}) },
        executeManagementModel,
        {},
        reserveDB,
        {},
        {},
        {},
        { emitUpdated: () => {} },
    );

    model.createEventRelayReserve = async programId => {
        const reserve = new Reserve();
        reserve.programId = programId;
        reserve.startAt = 1000;
        reserve.endAt = 2000;

        return reserve;
    };
    model.checkSingleReserveConflict = async () => {};

    return { model, reserves, getUnlockCount: () => unlockCount };
};

test('同じ番組への並行イベントリレー予約は 1 件だけ作成し、後発は null を返す', async () => {
    const { model, reserves, getUnlockCount } = createModel();
    const parentReserve = new Reserve();
    parentReserve.id = 1;

    const results = await Promise.all([
        model.addEventRelay(100, parentReserve),
        model.addEventRelay(100, parentReserve),
    ]);

    assert.equal(reserves.length, 1);
    assert.equal(results.filter(result => result !== null).length, 1);
    assert.deepEqual(results.filter(result => result === null), [null]);
    assert.equal(getUnlockCount(), 2);
});

test('イベントリレー予約の生成失敗時も実行権を解放する', async () => {
    const { model, getUnlockCount } = createModel();
    model.createEventRelayReserve = async () => {
        throw new Error('CreateReserveError');
    };
    const parentReserve = new Reserve();

    await assert.rejects(model.addEventRelay(100, parentReserve), /CreateReserveError/);
    assert.equal(getUnlockCount(), 1);
});
