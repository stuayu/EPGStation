'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fixture = require('./fixtures/reservation-allocation-baseline.json');
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;
const Tuner = require('../../dist/model/operator/reservation/Tuner').default;
const Reserve = require('../../dist/db/entities/Reserve').default;
const { planSchedule } = require('../../dist/model/operator/reservation/planner/SchedulePlanner');
const { resolveRecordingTimingConfig } = require('../../dist/model/operator/recording/RecordingTimingConfig');

const makeReserve = (values = {}) =>
    Object.assign(new Reserve(), {
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
        {},
        {},
        { findTimeRanges: async () => [], updateMany: async () => {}, ...reserveDB },
        {},
        {},
        {},
        { emitUpdated() {} },
    );
};

test('createReserves は時間順スイープと先着チューナー割当を使い、競合を記録する', () => {
    const model = makeModel();
    model.setTuners(
        fixture.tuners.map(tuner => ({ ...tuner, name: `tuner-${tuner.index}`, command: '', isAvailable: true })),
    );
    const input = fixture.reserves.map(row => makeReserve(row));
    const result = model.createReserves(input);
    const snapshot = Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict]));

    assert.deepEqual(snapshot, fixture.expectedConflicts);
    assert.deepEqual(
        input.map(reserve => reserve.id),
        [5, 1, 2, 7, 3, 4, 6],
    );
});

test('Phase 0 コーパスで planner の完全録画数と欠損時間が legacy より悪化しない', () => {
    const reserves = fixture.reserves.map((row, index) => ({ ...row, id: row.id, priority: index }));
    const plans = planSchedule({
        reservations: reserves.map(reserve => ({
            id: reserve.id,
            startAt: reserve.startAt,
            endAt: reserve.endAt,
            channel: reserve.channel,
            channelType: reserve.channelType,
            allowEndLack: reserve.allowEndLack,
            isSkip: false,
            isOverlap: false,
            priority: reserve.priority,
        })),
        tuners: fixture.tuners,
        timing: resolveRecordingTimingConfig({}, 0, 0),
    });
    const legacyComplete = Object.values(fixture.expectedConflicts).filter(conflict => conflict === false).length;
    const plannerComplete = plans.filter(plan => plan.conflict === null).length;
    const plannerLostSeconds = plans.reduce((sum, plan) => sum + plan.lostMs, 0) / 1000;
    const legacyLostSeconds =
        fixture.reserves.reduce(
            (sum, reserve) => sum + (fixture.expectedConflicts[reserve.id] ? reserve.endAt - reserve.startAt : 0),
            0,
        ) / 1000;
    const plannerSwitches = countChannelSwitches(
        plans
            .filter(plan => plan.conflict === null)
            .map(plan => {
                const row = fixture.reserves.find(reserve => reserve.id === plan.reserveId);
                return { tunerIndex: plan.tunerIndex, channel: row.channel, startAt: row.startAt };
            }),
    );
    const legacySwitches = 1; // legacy first-fit の成功予約は tuner 0 が GR-3 から GR-1 へ1回切替
    const legacyConflictIds = Object.keys(fixture.expectedConflicts)
        .filter(id => fixture.expectedConflicts[id])
        .map(Number);
    const plannerConflictIds = plans
        .filter(plan => plan.conflict !== null && plan.conflict.type !== 'MARGIN_OVERLAP')
        .map(plan => plan.reserveId);
    const conflictDifferences = [...new Set([...legacyConflictIds, ...plannerConflictIds])].filter(
        id => legacyConflictIds.includes(id) !== plannerConflictIds.includes(id),
    );
    assert.ok(plannerComplete >= legacyComplete, `planner ${plannerComplete} / legacy ${legacyComplete}`);
    assert.ok(plannerLostSeconds <= legacyLostSeconds, `planner ${plannerLostSeconds}s / legacy ${legacyLostSeconds}s`);
    assert.ok(plannerSwitches <= legacySwitches, `planner ${plannerSwitches} / legacy ${legacySwitches}`);
    assert.deepEqual(
        conflictDifferences.sort((a, b) => a - b),
        [3, 5],
    );
});

const countChannelSwitches = assignments => {
    const byTuner = new Map();
    for (const assignment of assignments) {
        if (assignment.tunerIndex === null) continue;
        const channels = byTuner.get(assignment.tunerIndex) ?? [];
        channels.push(assignment);
        byTuner.set(assignment.tunerIndex, channels);
    }
    let switches = 0;
    for (const channels of byTuner.values()) {
        channels.sort((a, b) => a.startAt - b.startAt);
        for (let i = 1; i < channels.length; i++) {
            if (channels[i].channel !== channels[i - 1].channel) switches++;
        }
    }
    return switches;
};

test('createReserves では同時刻終了と開始は競合せず、first-fit の割当を行う', () => {
    const model = makeModel();
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = model.createReserves([
        makeReserve({ id: 1, startAt: 1000, endAt: 2000 }),
        makeReserve({ id: 2, startAt: 2000, endAt: 3000, updateTime: 2 }),
    ]);
    assert.deepEqual(
        result.map(reserve => reserve.isConflict),
        [false, false],
    );
});

test('createReserves の現状の挙動 (Phase 6 で変更予定): 一度競合した予約は競合のまま残る', () => {
    const model = makeModel();
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = model.createReserves([
        makeReserve({ id: 1, channel: 'GR-1', startAt: 1000, endAt: 2000, updateTime: 1 }),
        makeReserve({ id: 2, channel: 'GR-2', startAt: 1500, endAt: 2500, updateTime: 2 }),
        makeReserve({ id: 3, channel: 'GR-1', startAt: 2000, endAt: 3000, updateTime: 3 }),
    ]);
    assert.deepEqual(Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict])), {
        1: false,
        2: true,
        3: true,
    });
});

test('createReserves の現状の挙動 (Phase 6 で変更予定): 後から始まる高優先予約が既存予約を押し出す', () => {
    const model = makeModel();
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = model.createReserves([
        makeReserve({ id: 1, channel: 'GR-1', startAt: 1000, endAt: 3000, ruleId: 1 }),
        makeReserve({
            id: 2,
            channel: 'GR-2',
            startAt: 1500,
            endAt: 2500,
            ruleId: null,
            isTimeSpecified: true,
            updateTime: 99,
        }),
    ]);
    assert.deepEqual(Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict])), {
        1: true,
        2: false,
    });
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
    assert.deepEqual(
        sorted.map(reserve => reserve.id),
        [5, 4, 2, 3, 1],
    );
});

test('予約差分は conflictInfo と plannedTunerIndex の変更を保存対象にする', () => {
    const model = makeModel();
    const previous = makeReserve({ id: 1, programId: 9, plannedTunerIndex: 0, conflictInfo: null });
    const next = makeReserve({ id: 1, programId: 9, plannedTunerIndex: 1, conflictInfo: '{"type":"MARGIN_OVERLAP"}' });
    assert.equal(model.checkProgramIdReserveDiff(previous, next), true);
    assert.equal(
        model.checkTimeRuleReserveDiff(
            makeReserve({ id: 1, programId: 9, ruleId: 1, plannedTunerIndex: 0, conflictInfo: null }),
            makeReserve({
                id: 1,
                programId: 9,
                ruleId: 1,
                plannedTunerIndex: 1,
                conflictInfo: '{"type":"MARGIN_OVERLAP"}',
            }),
        ),
        true,
    );
});

test('Tuner.add は types が空のとき常に false を返す (現状の挙動)', () => {
    const tuner = new Tuner({ types: [], name: 'empty', index: 0, command: '', isAvailable: true });
    assert.equal(tuner.add(makeReserve()), false);
});

test('checkSingleReserveConflict は既存予約を競合させる手動予約を拒否する', async () => {
    const model = makeModel({ findTimeRanges: async () => [makeReserve({ id: 1, channel: 'GR-1', updateTime: 1 })] });
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    await assert.rejects(
        model.checkSingleReserveConflict(makeReserve({ id: 2, channel: 'GR-2', updateTime: 2 })),
        /ReservationManageModelAddReserveConflict/,
    );
});

test('createDiff は重複予約の連鎖が止まるまで再計算窓を広げる', async () => {
    const direct = makeReserve({ id: 10, programId: 10, ruleId: 1, startAt: 1000, endAt: 2000 });
    const chained = makeReserve({ id: 11, programId: 11, ruleId: 1, startAt: 1900, endAt: 3000 });
    const db = {
        findTimeRanges: async option =>
            [direct, chained].filter(reserve =>
                option.times.some(range => reserve.startAt < range.endAt && reserve.endAt > range.startAt),
            ),
        updateMany: async diff => {
            db.lastDiff = diff;
        },
    };
    const model = makeModel(db);
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const changed = makeReserve({
        id: 12,
        programId: 12,
        ruleId: null,
        channel: 'GR-2',
        startAt: 1500,
        endAt: 2500,
        name: '変更番組',
    });
    const option = {
        times: [{ startAt: changed.startAt, endAt: changed.endAt }],
        hasSkip: false,
        hasConflict: false,
        hasOverlap: false,
    };

    const diff = await model.createDiff(option, [changed], [], true);
    assert.equal(db.lastDiff, diff);
    assert.deepEqual(
        diff.insert.map(reserve => reserve.id),
        [12],
    );
    assert.deepEqual(
        diff.update.map(reserve => reserve.id).sort((a, b) => a - b),
        [10, 11],
    );
    assert.equal(
        [...diff.insert, ...diff.update].some(reserve => reserve.id === chained.id),
        true,
    );
    assert.deepEqual(option.times, [{ startAt: 1500, endAt: 2500 }]);
});
