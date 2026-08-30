'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveDataBroadcastingTime } = require('../../dist/model/service/dataBroadcasting/DataBroadcastingTime');

test('録画再生位置を放送時刻へ変換する', () => {
    assert.equal(resolveDataBroadcastingTime(1700000000000, 12.345), 1700000012345);
    assert.equal(resolveDataBroadcastingTime(1700000000000, -1), 1700000000000);
});

test('放送時刻または再生位置が不正なら null', () => {
    assert.equal(resolveDataBroadcastingTime(null, 1), null);
    assert.equal(resolveDataBroadcastingTime(1700000000000, Number.NaN), null);
});

test('シーク・一時停止の位置を都度反映できる', () => {
    const startAt = 1700000000000;
    assert.deepEqual([0, 90, 12.5].map(position => resolveDataBroadcastingTime(startAt, position)), [startAt, startAt + 90000, startAt + 12500]);
});
