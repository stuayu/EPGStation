'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { getJstDay, getJstMidnight } = require('../../dist/util/JstDateUtil');

test('JST の日付境界と曜日は実行環境のタイムゾーンに依存しない', () => {
    const timestamp = Date.UTC(2026, 0, 1, 14, 59, 59, 999);
    assert.equal(getJstMidnight(timestamp), Date.UTC(2025, 11, 31, 15));
    assert.equal(getJstDay(timestamp), 4);
    assert.equal(getJstMidnight(timestamp + 1), Date.UTC(2026, 0, 1, 15));
    assert.equal(getJstDay(timestamp + 1), 5);
});
