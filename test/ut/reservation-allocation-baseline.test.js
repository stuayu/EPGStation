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

const makeModel = (reserveDB = {}, options = {}) => {
    const noopLogger = {
        getLogger: () => ({
            system: { info: (...args) => options.logs?.push(args), debug() {}, warn() {}, error() {}, fatal() {} },
        }),
    };
    return new ReservationManageModel(
        noopLogger,
        { getConfig: () => ({ reservation: { scheduler: 'legacy' }, ...options.config }) },
        {},
        {},
        { findTimeRanges: async () => [], updateMany: async () => {}, ...reserveDB },
        {},
        options.programDB ?? {},
        {},
        { emitUpdated() {} },
    );
};

test('legacy 並走比較は差分のない予約を記録せず、未定尺番組照会をチャンネル単位にまとめる', async () => {
    const logs = [];
    let scheduleCalls = 0;
    const model = makeModel(
        {},
        {
            logs,
            programDB: {
                findSchedule: async () => {
                    scheduleCalls++;
                    return [];
                },
            },
        },
    );
    model.setTuners([{ index: 0, name: 'tuner-0', types: ['GR'], command: '', isAvailable: true }]);
    const input = [1, 2, 3].map((id, index) =>
        makeReserve({
            id,
            channel: 'GR-1',
            channelId: 1,
            programId: 100 + id,
            isTimeUndefined: true,
            startAt: 1000 + index * 3000,
            endAt: 2000 + index * 3000,
        }),
    );

    await model.createReserves(input);
    assert.equal(logs.length, 0);
    assert.ok(scheduleCalls < input.length, `findSchedule calls ${scheduleCalls} for ${input.length} reserves`);
});

test('未定尺の予約が同じチャンネルなら findSchedule を予約数より少なく呼ぶ', async () => {
    let scheduleCalls = 0;
    const model = makeModel(
        {},
        {
            config: { reservation: { scheduler: 'planner' } },
            programDB: {
                findSchedule: async () => {
                    scheduleCalls++;
                    return [];
                },
            },
        },
    );
    model.setTuners([{ index: 0, name: 'tuner-0', types: ['GR'], command: '', isAvailable: true }]);
    const input = [1, 2, 3].map((id, index) =>
        makeReserve({
            id,
            channel: 'GR-1',
            channelId: 1,
            programId: 100 + id,
            isTimeUndefined: true,
            startAt: 1000 + index * 3000,
            endAt: 2000 + index * 3000,
        }),
    );

    await model.createPlannerReserves(input);
    assert.ok(scheduleCalls < input.length, `findSchedule calls ${scheduleCalls} for ${input.length} reserves`);
});

test('createReserves は時間順スイープと先着チューナー割当を使い、競合を記録する', async () => {
    const model = makeModel({}, { config: { reservation: { scheduler: 'legacy' } } });
    model.setTuners(
        fixture.tuners.map(tuner => ({ ...tuner, name: `tuner-${tuner.index}`, command: '', isAvailable: true })),
    );
    const input = fixture.reserves.map(row => makeReserve(row));
    const result = await model.createReserves(input);
    const snapshot = Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict]));

    assert.deepEqual(snapshot, fixture.expectedConflicts);
    assert.deepEqual(
        input.map(reserve => reserve.id),
        [5, 1, 2, 7, 3, 4, 6],
    );
});

test('Phase 0 コーパスで planner の完全録画数と欠損時間が legacy より悪化しない', () => {
    const model = makeModel({}, { config: { reservation: { scheduler: 'planner' } } });
    const reserves = fixture.reserves.map(row => makeReserve(row));
    const rank = new Map([...reserves].sort(model.sortReserve).map((reserve, index) => [reserve.id, index]));
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
            priority: rank.get(reserve.id),
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
        [],
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

test('createReserves では同時刻終了と開始は競合せず、first-fit の割当を行う', async () => {
    const model = makeModel({}, { config: { reservation: { scheduler: 'legacy' } } });
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = await model.createReserves([
        makeReserve({ id: 1, startAt: 1000, endAt: 2000 }),
        makeReserve({ id: 2, startAt: 2000, endAt: 3000, updateTime: 2 }),
    ]);
    assert.deepEqual(
        result.map(reserve => reserve.isConflict),
        [false, false],
    );
});

test('legacy は一度競合した予約を競合のまま残す', async () => {
    const model = makeModel({}, { config: { reservation: { scheduler: 'legacy' } } });
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = await model.createReserves([
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

test('planner は先行予約の終了後に同じチャンネルの予約を割り当てる', async () => {
    const model = makeModel({}, { config: { reservation: { scheduler: 'planner' } } });
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = await model.createReserves([
        makeReserve({ id: 1, channel: 'GR-1', startAt: 1000, endAt: 2000, updateTime: 1 }),
        makeReserve({ id: 2, channel: 'GR-2', startAt: 1500, endAt: 2500, updateTime: 2 }),
        makeReserve({ id: 3, channel: 'GR-1', startAt: 2000, endAt: 3000, updateTime: 3 }),
    ]);
    assert.deepEqual(Object.fromEntries(result.map(reserve => [reserve.id, reserve.isConflict])), {
        1: false,
        2: true,
        3: false,
    });
});

test('createReserves の現状の挙動 (Phase 6 で変更予定): 後から始まる高優先予約が既存予約を押し出す', async () => {
    const model = makeModel({}, { config: { reservation: { scheduler: 'legacy' } } });
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = await model.createReserves([
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

test('Planner は未定番組を同一局の次番組開始で切り詰め、表示用 endAt を維持する', async () => {
    const model = makeModel();
    model.configuration = { getConfig: () => ({ reservation: { scheduler: 'planner' } }) };
    model.programDB = {
        findSchedule: async () => [{ startAt: 1100, endAt: 1200 }],
    };
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    const result = await model.createReserves([
        makeReserve({
            id: 1,
            programId: 5001,
            channelId: 1,
            channel: 'GR-1',
            startAt: 1000,
            endAt: 1000 + 3 * 60 * 60 * 1000,
            isTimeUndefined: true,
        }),
        makeReserve({ id: 2, channelId: 2, channel: 'GR-2', startAt: 1200, endAt: 1300 }),
    ]);
    assert.equal(result.find(reserve => reserve.id === 1).isConflict, false);
    assert.equal(result.find(reserve => reserve.id === 1).endAt, 1000 + 3 * 60 * 60 * 1000);
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

test('sortReserve は既定 priority では旧順を保ち、priority を先に比較する', () => {
    const model = makeModel();
    const sorted = [makeReserve({ id: 1, priority: 3 }), makeReserve({ id: 2, priority: 5 })].sort(model.sortReserve);
    assert.deepEqual(
        sorted.map(reserve => reserve.id),
        [2, 1],
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

test('planner は時刻指定の手動予約追加直後に plannedTunerIndex を保存する', async () => {
    const existing = makeReserve({ id: 1, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
    const reserves = [existing];
    const reserveDB = {
        findTimeSpecification: async () => null,
        findTimeRanges: async ({ times }) =>
            reserves.filter(reserve =>
                times.some(time => reserve.startAt < time.endAt && reserve.endAt > time.startAt),
            ),
        insertOnce: async reserve => {
            reserve.id = 2;
            reserves.push(reserve);
            return reserve.id;
        },
        updateMany: async ({ update = [] }) => {
            for (const updated of update) {
                const index = reserves.findIndex(reserve => reserve.id === updated.id);
                if (index !== -1) reserves[index] = updated;
            }
        },
    };
    const model = new ReservationManageModel(
        {
            getLogger: () => ({
                system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} },
                stream: { error() {} },
            }),
        },
        { getConfig: () => ({ reservation: { scheduler: 'planner' }, recording: {} }) },
        { getExecution: async () => 1, unLockExecution() {} },
        { checkEncodeOption: () => true },
        reserveDB,
        { findId: async () => ({ id: 1, channel: 'GR-1', channelType: 'GR' }) },
        {},
        {},
        { emitUpdated() {} },
    );
    model.setTuners([{ index: 0, name: 'tuner-0', types: ['GR'], command: '', isAvailable: true }]);

    await model.add({
        allowEndLack: false,
        timeSpecifiedOption: {
            name: '手動予約',
            channelId: 1,
            startAt: existing.startAt,
            endAt: existing.endAt,
        },
    });

    assert.equal(reserves.find(reserve => reserve.id === 2).plannedTunerIndex, 0);
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

test('上位の手動予約は PREEMPT_LOWER_PRIORITY で下位予約を押し出して追加できる', async () => {
    const model = makeModel({ findTimeRanges: async () => [makeReserve({ id: 1, priority: 2, channel: 'GR-1' })] });
    model.setTuners([{ types: ['GR'], index: 0, name: 'GR', command: '', isAvailable: true }]);
    await assert.doesNotReject(
        model.checkSingleReserveConflict(
            makeReserve({ id: undefined, channel: 'GR-2', priority: 5, conflictPolicy: 'PREEMPT_LOWER_PRIORITY' }),
        ),
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
