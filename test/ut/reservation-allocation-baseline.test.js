'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fixture = require('./fixtures/reservation-allocation-baseline.json');
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;
const Tuner = require('../../dist/model/operator/reservation/Tuner').default;
const Reserve = require('../../dist/db/entities/Reserve').default;

const makeReserve = (values = {}) => Object.assign(new Reserve(), {
    id: 1,
    updateTime: 1,
    startAt: 1000,
    endAt: 2000,
    channelId: 1,
    channel: 'GR-1',
    channelType: 'GR',
    name: '番組',
    programId: null,
    ruleId: null,
    ...values,
});

const makeModel = (reserveDB = {}) => {
    const noopLogger = { getLogger: () => ({ system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} } }) };
    return new ReservationManageModel(
        noopLogger,
        { getConfig: () => ({}) },
        {}, {},
        { findTimeRanges: async () => [], updateMany: async () => {}, ...reserveDB },
        {}, {}, {},
        { emitUpdated() {} },
    );
};

test('createReserves は時間順スイープと先着チューナー割当を使い、競合を記録する', () => {
    const model = makeModel();
    model.setTuners(fixture.tuners.map(tuner => ({ ...tuner, name: `tuner-${tuner.index}`, command: '', isAvailable: true })));
    const input = fixture.reserves.map(row => makeReserve(row));
    const result = model.createReserves(input);
    const snapshot = Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict]));

    assert.deepEqual(snapshot, fixture.expectedConflicts);
    assert.deepEqual(input.map(reserve => reserve.id), [5, 1, 2, 7, 3, 4, 6]);
});

test('createReserves では同時刻終了と開始は競合せず、first-fit の割当を行う', () => {
    const model = makeModel();
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = model.createReserves([
        makeReserve({ id: 1, startAt: 1000, endAt: 2000 }),
        makeReserve({ id: 2, startAt: 2000, endAt: 3000, updateTime: 2 }),
    ]);
    assert.deepEqual(result.map(reserve => reserve.isConflict), [false, false]);
});

test('createReserves の現状の挙動 (Phase 6 で変更予定): 一度競合した予約は競合のまま残る', () => {
    const model = makeModel();
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = model.createReserves([
        makeReserve({ id: 1, channel: 'GR-1', startAt: 1000, endAt: 2000, updateTime: 1 }),
        makeReserve({ id: 2, channel: 'GR-2', startAt: 1500, endAt: 2500, updateTime: 2 }),
        makeReserve({ id: 3, channel: 'GR-1', startAt: 2000, endAt: 3000, updateTime: 3 }),
    ]);
    assert.deepEqual(Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict])), { 1: false, 2: true, 3: true });
});

test('createReserves の現状の挙動 (Phase 6 で変更予定): 後から始まる高優先予約が既存予約を押し出す', () => {
    const model = makeModel();
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = model.createReserves([
        makeReserve({ id: 1, channel: 'GR-1', startAt: 1000, endAt: 3000, ruleId: 1 }),
        makeReserve({ id: 2, channel: 'GR-2', startAt: 1500, endAt: 2500, ruleId: null, isTimeSpecified: true, updateTime: 99 }),
    ]);
    assert.deepEqual(Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict])), { 1: true, 2: false });
});

test('sortReserve は時刻指定手動、通常手動、ルールの順で優先し同種内を既定キーで並べる', () => {
    const model = makeModel();
    const sorted = [
        makeReserve({ id: 1, ruleId: 7 }),
        makeReserve({ id: 2, ruleId: null, updateTime: 20 }),
        makeReserve({ id: 3, ruleId: 3 }),
        makeReserve({ id: 4, ruleId: null, updateTime: 10 }),
        makeReserve({ id: 5, ruleId: null, isTimeSpecified: true, updateTime: 99 }),
    ].sort(model.sortReserve);
    assert.deepEqual(sorted.map(reserve => reserve.id), [5, 4, 2, 3, 1]);
});

test('Tuner.add は types が空のとき常に false を返す (現状の挙動)', () => {
    const tuner = new Tuner({ types: [], name: 'empty', index: 0, command: '', isAvailable: true });
    assert.equal(tuner.add(makeReserve()), false);
});

test('checkSingleReserveConflict は既存予約を競合させる手動予約を拒否する', async () => {
    const model = makeModel({ findTimeRanges: async () => [makeReserve({ id: 1, channel: 'GR-1', updateTime: 1 })] });
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    await assert.rejects(model.checkSingleReserveConflict(makeReserve({ id: 2, channel: 'GR-2', updateTime: 2 })), /ReservationManageModelAddReserveConflict/);
});

test('createDiff は DB スタブから得た変更窓内だけ再計算し、連鎖する予約へ広げない (現状の挙動; Phase 6 で変更予定)', async () => {
    const direct = makeReserve({ id: 10, programId: 10, ruleId: 1, startAt: 1000, endAt: 2000 });
    const chained = makeReserve({ id: 11, programId: 11, ruleId: 1, startAt: 1900, endAt: 3000 });
    const db = {
        findTimeRanges: async () => [direct],
        updateMany: async diff => { db.lastDiff = diff; },
    };
    const model = makeModel(db);
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const changed = makeReserve({ id: 12, programId: 12, ruleId: null, channel: 'GR-2', startAt: 1500, endAt: 2500, name: '変更番組' });
    const option = { times: [{ startAt: changed.startAt, endAt: changed.endAt }], hasSkip: false, hasConflict: false, hasOverlap: false };

    const diff = await model.createDiff(option, [changed], [], true);
    assert.equal(db.lastDiff, diff);
    assert.deepEqual(diff.insert.map(reserve => reserve.id), [12]);
    assert.deepEqual(diff.update.map(reserve => [reserve.id, reserve.isConflict]), [[10, true]]);
    assert.equal([...diff.insert, ...diff.update].some(reserve => reserve.id === chained.id), false);
    assert.deepEqual(option.times, [{ startAt: 1500, endAt: 2500 }]);
});
