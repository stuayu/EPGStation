'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldWaitForTailGrowth } = require('../../dist/lib/TailStream');

test('録画継続中は上限内の無成長を許し、状態終了または上限到達で閉じる', () => {
    assert.equal(shouldWaitForTailGrowth(true, 1000, 60_000), true);
    assert.equal(shouldWaitForTailGrowth(false, 1000, 60_000), false);
    assert.equal(shouldWaitForTailGrowth(true, 60_000, 60_000), false);
});
