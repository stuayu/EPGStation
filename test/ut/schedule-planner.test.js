'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { planSchedule } = require('../../dist/model/operator/reservation/planner/SchedulePlanner');

const timing = { prepMs: 120000, startMarginMs: 0, endMarginMs: 0 };
const reserve = (id, channel, channelType, startAt, endAt, values = {}) => ({
    id,
    channel,
    channelType,
    startAt,
    endAt,
    ...values,
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
    assert.deepEqual(plans.map(plan => plan.tunerIndex), [1, 0]);
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
