'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    summarizePlaybackStalls,
    evaluatePlaybackStability,
    parsePlaybackTime,
    matchJikkyoCommentTimes,
    evaluateJikkyoSync,
    evaluateEmsgCoverage,
} = require('../../dist/util/PlaybackHarnessUtil');

const sample = (at, currentTime, paused = false) => ({ at, currentTime, paused });

test('再生中の連続停止を回数・最長時間・合計時間へ集計する', () => {
    assert.deepEqual(
        summarizePlaybackStalls([sample(0, 0), sample(2000, 0), sample(4000, 0), sample(6000, 1), sample(8000, 1), sample(10000, 2)]),
        { stopCount: 2, maxStallSeconds: 4, totalStallSeconds: 6 },
    );
});

test('一時停止中の無進行を停止として数えない', () => {
    assert.deepEqual(summarizePlaybackStalls([sample(0, 10, true), sample(4000, 10, true)]), {
        stopCount: 0,
        maxStallSeconds: 0,
        totalStallSeconds: 0,
    });
});

test('再生安定性は停止回数・最長停止・最低進行量で合否判定する', () => {
    const samples = [sample(0, 0), sample(2000, 0), sample(4000, 1), sample(6000, 2)];
    assert.equal(evaluatePlaybackStability(samples, { maxStops: 1, maxStallSeconds: 2, minProgressSeconds: 1 }).passed, true);
    assert.equal(evaluatePlaybackStability(samples, { maxStops: 0 }).passed, false);
    assert.equal(evaluatePlaybackStability([sample(0, 0)], { minProgressSeconds: 1 }).reason, '再生進行 0.000s < 1s');
});

test('DPlayer 時刻表示を分秒・時分秒へ変換し、不正値を拒否する', () => {
    assert.equal(parsePlaybackTime('01:02'), 62);
    assert.equal(parsePlaybackTime('01:02:03'), 3723);
    assert.equal(parsePlaybackTime('x'), null);
});

test('実況本文を最も近い過去ログ時刻へ突き合わせる', () => {
    const matches = matchJikkyoCommentTimes(
        [{ positionText: '00:10', texts: ['a', 'a', 'missing'] }],
        { a: [9_000, 10_800] },
        0,
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].actualAtMs, 10_800);
    assert.equal(matches[0].driftSeconds, 0.8);
    assert.equal(evaluateJikkyoSync(matches, { maxDriftSeconds: 1 }).passed, true);
    assert.equal(evaluateJikkyoSync([], { minSamples: 1 }).passed, false);
    assert.equal(evaluateJikkyoSync(matches, { maxDriftSeconds: 0.1 }).passed, false);
});

test('実況と emsg の標本不足・比率不足を不合格にする', () => {
    assert.equal(evaluateEmsgCoverage([], 1, 1).passed, false);
    assert.equal(evaluateEmsgCoverage([true, false], 1, 1).passed, false);
    assert.equal(evaluateEmsgCoverage([true, true], 1, 2).passed, true);
});
