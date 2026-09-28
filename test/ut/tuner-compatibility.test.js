'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Tuner = require('../../dist/model/operator/reservation/Tuner').default;
const { planSchedule } = require('../../dist/model/operator/reservation/planner/SchedulePlanner');
const TunerCompatibilityUtil = require('../../dist/util/TunerCompatibilityUtil').default;
const tuners = require('../fixtures/prod-tuners.json');

const timing = { prepMs: 0, startMarginMs: 0, endMarginMs: 0 };
const makeReserve = channelType => ({
    id: 1,
    channel: `${channelType}-1`,
    channelType,
    startAt: 1000,
    endAt: 2000,
});

test('本番チューナー fixture で NW21 を GR tuner に割り当て、空 types は最後にする', () => {
    const reserve = makeReserve('NW21');
    const legacyAccepted = tuners.filter(tuner => tuner.types.includes(reserve.channelType));
    assert.equal(legacyAccepted.length, 0);
    assert.equal(
        tuners.filter(tuner => TunerCompatibilityUtil.isTunerCompatibleWithChannelType(tuner.types, 'NW21')).length,
        28,
    );
    const accepted = tuners.filter(tuner => new Tuner({ ...tuner }).add(reserve));
    assert.equal(accepted.length, 28);
    assert.equal(tuners.filter(tuner => tuner.types.includes('NW21')).length, 0, '旧来の完全一致判定');
    const legacyPlannerIndex = tuners.find(tuner =>
        (tuner.types.length === 0 ? ['GR', 'BS', 'CS', 'SKY', 'NW21'] : tuner.types).includes('NW21'),
    ).index;
    assert.equal(legacyPlannerIndex, 5, '旧 planner は空 types の SPHD を選ぶ');
    const plans = planSchedule({ reservations: [reserve], tuners, timing });
    assert.equal(plans[0].tunerIndex, 0);
    assert.notEqual(tuners.find(tuner => tuner.index === plans[0].tunerIndex).name, 'SPHD');

    const legacyEmptyTuner = new Tuner({ types: [], index: 5 });
    assert.equal(legacyEmptyTuner.add(reserve), false);
});

test('NW の完全一致を受け入れ、NW/GR 以外の既存互換性を保つ', () => {
    assert.equal(TunerCompatibilityUtil.isTunerCompatibleWithChannelType(['NW21'], 'NW21'), true);
    assert.equal(TunerCompatibilityUtil.isTunerCompatibleWithChannelType(['BS'], 'NW21'), false);
    assert.equal(TunerCompatibilityUtil.isTunerCompatibleWithChannelType([], 'NW21'), false);
    for (const [type, expected] of [
        ['GR', 0],
        ['BS', 0],
        ['BS4K', 5],
        ['SKY', 5],
    ]) {
        assert.equal(
            planSchedule({ reservations: [makeReserve(type)], tuners, timing })[0].tunerIndex,
            expected,
            `${type} tuner`,
        );
    }
    assert.equal(
        planSchedule({
            reservations: [makeReserve('NW21')],
            tuners: [{ index: 5, types: [] }],
            timing,
        })[0].tunerIndex,
        5,
        'empty types fallback remains available when it is the only tuner',
    );
});
