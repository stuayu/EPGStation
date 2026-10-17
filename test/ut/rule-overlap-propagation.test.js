'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { getRuleOverlapProgramIds, isRuleOverlapSource, shouldPropagateRuleOverlap } = require('../../dist/model/operator/reservation/RuleOverlapPropagation');
const reservation = overrides => ({ ruleId: 1, programId: 10, isEventRelay: false, isTimeSpecified: false, isOverlap: true, isIgnoreOverlap: false, ...overrides });

test('同じ番組の別ルールへ重複判定が波及する', () => {
    assert.equal(shouldPropagateRuleOverlap(reservation({ ruleId: 2, isOverlap: false }), reservation()), true);
});

for (const side of ['target', 'source']) {
    for (const overrides of [
        { ruleId: null }, { programId: null }, { isEventRelay: true },
        { isTimeSpecified: true }, { isIgnoreOverlap: true },
    ]) {
        test(`${side} の ${JSON.stringify(overrides)} には重複を波及しない`, () => {
            const target = reservation({ ruleId: 2, ...(side === 'target' ? overrides : {}) });
            const source = reservation(side === 'source' ? overrides : {});
            assert.equal(shouldPropagateRuleOverlap(target, source), false);
        });
    }
}

test('同一ルール・異なる番組・通常予約から重複を波及しない', () => {
    assert.equal(shouldPropagateRuleOverlap(reservation(), reservation()), false);
    assert.equal(shouldPropagateRuleOverlap(reservation({ ruleId: 2, programId: 11 }), reservation()), false);
    assert.equal(shouldPropagateRuleOverlap(reservation({ ruleId: 2 }), reservation({ isOverlap: false })), false);
});

test('波及元判定と overlap 番組集合を共通ヘルパーで作る', () => {
    const source = reservation();
    assert.equal(isRuleOverlapSource(source), true);
    assert.equal(isRuleOverlapSource(reservation({ isTimeSpecified: true })), false);
    assert.deepEqual([...getRuleOverlapProgramIds([
        source,
        reservation({ programId: 11 }),
        reservation({ isIgnoreOverlap: true }),
        reservation({ isEventRelay: true }),
    ])], [10, 11]);
});

require('reflect-metadata');
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;
const Reserve = require('../../dist/db/entities/Reserve').default;
for (const scheduler of ['legacy', 'planner']) {
    test(`${scheduler}: 同じ番組の通常予約は解除済みルールを優先し一件だけ保持する`, async () => {
        const model = new ReservationManageModel(
            { getLogger: () => ({ system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} } }) },
            { getConfig: () => ({ reservation: { scheduler } }) },
            {}, {}, {}, {}, {}, {}, { emitUpdated() {} },
        );
        model.setTuners([{ index: 0, name: 'tuner', types: ['GR'], command: '', isAvailable: true }]);
        const reserve = values => Object.assign(new Reserve(), {
            id: 1, ruleId: 1, programId: 10, channelId: 1, channel: 'GR-1', channelType: 'GR',
            startAt: 1000, endAt: 2000, updateTime: 1, ...values,
        });
        for (const reverse of [false, true]) {
            const input = [reserve({ id: 1, ruleId: 1, priority: 5 }), reserve({ id: 2, ruleId: 2, priority: 1, isIgnoreOverlap: true, isConflict: true })];
            const result = await model.createReserves(reverse ? input.reverse() : input);
            assert.equal(result.length, 1);
            assert.equal(result[0].ruleId, 2);
            assert.equal(result[0].isIgnoreOverlap, true);
            assert.equal(result[0].isOverlap, false);
            assert.equal(result[0].isConflict, false);
        }
    });
}
