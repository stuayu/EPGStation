'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    summarizePlaybackStalls,
    evaluatePlaybackStability,
    evaluatePlaybackFrames,
    parsePlaybackTime,
    matchJikkyoCommentTimes,
    evaluateJikkyoSync,
    evaluateEmsgCoverage,
} = require('../../dist/util/PlaybackHarnessUtil');

const sample = (at, currentTime, paused = false) => ({ at, currentTime, paused });
const frame = (averageLuma, maxLuma = averageLuma, standardDeviation = 10) => ({ averageLuma, maxLuma, standardDeviation });

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

test('映像判定は真っ黒フレームを不合格にする', () => {
    const result = evaluatePlaybackFrames([
        { ...sample(0, 0), frame: frame(4, 10) },
        { ...sample(1000, 1), frame: frame(5, 12) },
    ]);
    assert.equal(result.passed, false);
    assert.deepEqual(result.summary, {
        sampleCount: 2,
        validFrameCount: 2,
        frameFailureCount: 0,
        blackFrameCount: 2,
        blackFrameRatio: 1,
        frameChangeCount: 0,
    });
});

test('映像判定は明るい静止画を画面変化なしとして不合格にする', () => {
    const result = evaluatePlaybackFrames([
        { ...sample(0, 0), frame: frame(80, 120) },
        { ...sample(1000, 1), frame: frame(80, 120) },
    ]);
    assert.equal(result.passed, false);
    assert.equal(result.summary.frameChangeCount, 0);
    assert.match(result.reason, /画面変化回数/u);
});

test('映像判定は黒くなく平均輝度が変化するフレームを合格にする', () => {
    const result = evaluatePlaybackFrames([
        { ...sample(0, 0), frame: frame(40, 100) },
        { ...sample(1000, 1), frame: frame(70, 140) },
        { ...sample(2000, 2), frame: frame(35, 90) },
    ], { minFrameChanges: 2, frameChangeThreshold: 10 });
    assert.equal(result.passed, true);
    assert.equal(result.summary.frameChangeCount, 2);
});

test('映像判定は videoWidth 0 や drawImage 失敗に相当する取得失敗を不合格にする', () => {
    const result = evaluatePlaybackFrames([
        { ...sample(0, 0), frame: null },
        { ...sample(1000, 1), frame: frame(50, 100) },
    ]);
    assert.equal(result.passed, false);
    assert.equal(result.summary.frameFailureCount, 1);
    assert.match(result.reason, /取得失敗/u);
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
