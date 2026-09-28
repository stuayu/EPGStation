'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { planSchedule } = require('../../dist/model/operator/reservation/planner/SchedulePlanner');
const { toMirakurunPriority } = require('../../dist/model/operator/reservation/ReservationPriorityUtil');

const timing = { prepMs: 120000, startMarginMs: 0, endMarginMs: 0 };
const reserve = (id, channel, channelType, startAt, endAt, values = {}) => ({
    id,
    channel,
    channelType,
    startAt,
    endAt,
    ...values,
});

test('Mirakurun priority は録画をライブ視聴より優先し、競合録画を通常録画より下げる', () => {
    assert.equal(toMirakurunPriority(2, 3), 2);
    assert.equal(toMirakurunPriority(2, 5), 4);
    assert.equal(toMirakurunPriority(2, 1), 2);
    assert.equal(toMirakurunPriority(-1, 1), 2);
    assert.equal(toMirakurunPriority(2, undefined), 2);
    assert.deepEqual(
        [1, 2, 3, 4, 5].map(priority => [
            toMirakurunPriority(2, priority, 0, false, 2),
            toMirakurunPriority(1, priority, 0, true, 2),
        ]),
        [
            [2, 1],
            [2, 1],
            [2, 1],
            [3, 2],
            [4, 3],
        ],
    );
    assert.equal(toMirakurunPriority(8, 3, 7, false, 8), 9);
    assert.equal(toMirakurunPriority(7, 3, 7, true, 8), 8);
});

test('増加路で多波対応チューナーの偽競合を解消する', () => {
    const plans = planSchedule({
        reservations: [
            reserve(1, 'GR-1', 'GR', 0, 100, { priority: 1 }),
            reserve(2, 'BS-1', 'BS', 0, 100, { priority: 2 }),
        ],
        tuners: [
            { index: 0, types: ['GR', 'BS'] },
            { index: 1, types: ['GR'] },
        ],
        timing,
    });
    assert.deepEqual(
        plans.map(plan => plan.conflict),
        [null, null],
    );
    assert.deepEqual(
        plans.map(plan => plan.tunerIndex),
        [1, 0],
    );
    assert.equal(new Set(plans.map(plan => plan.tunerIndex)).size, 2);
});

test('重複区間の部分欠損時間を計算する', () => {
    const plans = planSchedule({
        reservations: [reserve(1, 'GR-1', 'GR', 0, 100), reserve(2, 'GR-2', 'GR', 50, 150)],
        tuners: [{ index: 0, types: ['GR'] }],
        timing,
    });
    assert.equal(plans.find(plan => plan.reserveId === 2).lostMs, 50);
    assert.equal(plans.find(plan => plan.reserveId === 2).conflict.type, 'PARTIAL_HEAD');
});

test('開始済み予約を固定し途中参加予約に明け渡さない', () => {
    const plans = planSchedule({
        reservations: [reserve(1, 'GR-1', 'GR', 0, 100), reserve(2, 'GR-2', 'GR', 50, 150)],
        tuners: [
            { index: 0, types: ['GR'] },
            { index: 1, types: ['GR'] },
        ],
        sessions: [{ reserveId: 1, tunerIndex: 0, started: true }],
        timing,
    });
    assert.equal(plans.find(plan => plan.reserveId === 1).tunerIndex, 0);
});

test('types が空なら全放送種別として補完した理由を残す', () => {
    const plan = planSchedule({
        reservations: [reserve(1, 'BS-1', 'BS', 0, 100)],
        tuners: [{ index: 0, types: [] }],
        timing,
    })[0];
    assert.equal(plan.conflict, null);
    assert.ok(plan.reasons.some(reason => reason.includes('empty-types-treated-as-all')));
});

test('allowEndLack の末尾15秒以内の欠損を許容する', () => {
    const plans = planSchedule({
        reservations: [reserve(1, 'GR-1', 'GR', 0, 100), reserve(2, 'GR-2', 'GR', 90, 100, { allowEndLack: true })],
        tuners: [{ index: 0, types: ['GR'] }],
        timing,
    });
    const tail = plans.find(plan => plan.reserveId === 2);
    assert.equal(tail.lostMs, 10);
    assert.equal(tail.conflict, null);
});

test('ALLOW_HEAD_LACK と ALLOW_PARTIAL は方針どおり欠損競合を許容する', () => {
    const head = planSchedule({
        reservations: [
            reserve(1, 'GR-1', 'GR', 0, 100, { priority: 1 }),
            reserve(2, 'GR-2', 'GR', 50, 150, { priority: 2, conflictPolicy: 'ALLOW_HEAD_LACK' }),
        ],
        tuners: [{ index: 0, types: ['GR'] }],
        timing,
    });
    const partial = planSchedule({
        reservations: [
            reserve(1, 'GR-1', 'GR', 0, 100, { priority: 1 }),
            reserve(2, 'GR-2', 'GR', 50, 150, { priority: 2, conflictPolicy: 'ALLOW_PARTIAL' }),
        ],
        tuners: [{ index: 0, types: ['GR'] }],
        timing,
    });
    assert.equal(head.find(plan => plan.reserveId === 2).conflict, null);
    assert.equal(partial.find(plan => plan.reserveId === 2).conflict, null);
});

test('PREEMPT_LOWER_PRIORITY は奪われた予約に PRIORITY_PREEMPTED を付ける', () => {
    const plans = planSchedule({
        reservations: [
            reserve(1, 'GR-1', 'GR', 0, 100, { priority: 5 }),
            reserve(2, 'GR-2', 'GR', 0, 100, { priority: 1, conflictPolicy: 'PREEMPT_LOWER_PRIORITY' }),
        ],
        tuners: [{ index: 0, types: ['GR'] }],
        timing,
    });
    assert.equal(plans.find(plan => plan.reserveId === 1).conflict.type, 'PRIORITY_PREEMPTED');
    assert.equal(plans.find(plan => plan.reserveId === 2).conflict, null);
});

test('録画予約が競合せず張り付きだけが重なる場合は MARGIN_OVERLAP を記録する', () => {
    const plans = planSchedule({
        reservations: [reserve(1, 'GR-1', 'GR', 0, 20), reserve(2, 'GR-2', 'GR', 100, 120)],
        tuners: [{ index: 0, types: ['GR'] }],
        timing: { prepMs: 120, startMarginMs: 0, endMarginMs: 0 },
    });
    const later = plans.find(plan => plan.reserveId === 2);
    assert.equal(later.lostMs, 0);
    assert.equal(later.conflict.type, 'MARGIN_OVERLAP');
});

test('同じ入力から常に同じ計画を返す', () => {
    const input = {
        reservations: [reserve(2, 'GR-2', 'GR', 0, 100), reserve(1, 'GR-1', 'GR', 0, 100)],
        tuners: [
            { index: 1, types: ['GR'] },
            { index: 0, types: ['GR'] },
        ],
        timing,
    };
    assert.deepEqual(planSchedule(input), planSchedule(input));
});
