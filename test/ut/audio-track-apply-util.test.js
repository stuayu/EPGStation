'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { applyAudioTrackWithRetry } = require('../../dist/util/AudioTrackApplyUtil');

// HLS の音声レンディション切替は「代入しただけ」では反映されないことがある
// (hls.js が音声トラック一覧を組み直している最中の代入は既定トラックへ戻される)。
// 反映を読み返し、駄目ならやり直すことを固定する。
const noWait = () => Promise.resolve();

test('1 回で反映されればやり直さない', async () => {
    let applied = 0;
    const result = await applyAudioTrackWithRetry(
        () => {
            applied++;
        },
        () => true,
        5,
        0,
        noWait,
    );

    assert.equal(result, true);
    assert.equal(applied, 1);
});

test('反映されるまでやり直す', async () => {
    let applied = 0;
    const result = await applyAudioTrackWithRetry(
        () => {
            applied++;
        },
        () => applied >= 3,
        5,
        0,
        noWait,
    );

    assert.equal(result, true);
    assert.equal(applied, 3);
});

test('最後まで反映されなければ false を返す (呼び出し側が再接続方式へ落とせる)', async () => {
    let applied = 0;
    const result = await applyAudioTrackWithRetry(
        () => {
            applied++;
        },
        () => false,
        4,
        0,
        noWait,
    );

    assert.equal(result, false);
    assert.equal(applied, 4);
});
