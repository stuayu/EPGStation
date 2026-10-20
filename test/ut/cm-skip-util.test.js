const test = require('node:test');
const assert = require('node:assert/strict');
const { findCmSkipTarget, getCmBlocks } = require('../../dist/util/CmSkipUtil');

test('CM skip merges adjacent CM chapters and skips only crossed starts before the end', () => {
    const blocks = getCmBlocks([
        { title: 'CM 1', startAt: 10, endAt: 20 },
        { title: ' cm 2 ', startAt: 20, endAt: 30 },
        { title: '本編', startAt: 30, endAt: 40 },
        { title: 'CM 終端', startAt: 90, endAt: 100 },
    ]);
    assert.deepEqual(blocks, [
        { startAt: 10, endAt: 30 },
        { startAt: 90, endAt: 100 },
    ]);
    assert.equal(findCmSkipTarget(9, 10.2, blocks, 100), 30);
    assert.equal(findCmSkipTarget(10.2, 11, blocks, 100), null);
    assert.equal(findCmSkipTarget(11, 10, blocks, 100), null);
    assert.equal(findCmSkipTarget(89, 91, blocks, 100), null);
    assert.equal(findCmSkipTarget(9, 10.2, blocks, 100, [0]), null);
});
