'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;

test('ルールに指定したマージンをルール予約へコピーする', () => {
    const model = Object.create(ReservationManageModel.prototype);
    const reserve = {};
    model.setProgramToRuleReserve(
        reserve,
        null,
        {
            id: 3,
            updateCnt: 4,
            reserveOption: { priority: 3, allowEndLack: true, startMarginSec: 0, endMarginSec: 12 },
        },
        100,
    );
    assert.equal(reserve.startMarginSec, 0);
    assert.equal(reserve.endMarginSec, 12);
});
