const test = require('node:test');
const assert = require('node:assert/strict');
const { findCmSkipTarget, getCmBlocks, shouldResetSkippedCmBlocksOnSeek, getCmHighlightRanges } = require('../../dist/util/CmSkipUtil');

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

test('手動で CM 区間外へ戻ると、再進入時に同じ CM を再スキップできる状態へ戻す', () => {
    const blocks = [{ startAt: 10, endAt: 30 }];
    const skippedBlocks = [0];
    assert.equal(findCmSkipTarget(9, 10.2, blocks, 100, skippedBlocks), null);
    if (shouldResetSkippedCmBlocksOnSeek(5, blocks) === true) skippedBlocks.length = 0;
    assert.equal(findCmSkipTarget(9, 10.2, blocks, 100, skippedBlocks), 30);
    assert.equal(shouldResetSkippedCmBlocksOnSeek(20, blocks), false);
});

test('シークバー用 CM 区間は動画尺で切り詰める', () => {
    assert.deepEqual(
        getCmHighlightRanges([{ startAt: -5, endAt: 10 }, { startAt: 90, endAt: 120 }], 100),
        [{ startAt: 0, endAt: 10 }, { startAt: 90, endAt: 100 }],
    );
    assert.deepEqual(getCmHighlightRanges([{ startAt: 10, endAt: 20 }], 0), []);
});
