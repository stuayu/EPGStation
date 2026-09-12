'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    detectPlaybackStall,
    estimatePlaybackBandwidthKbps,
    selectThroughputFallback,
    canAutoFallback,
} = require('../../dist/util/PlaybackStallDetector');

const sample = (at, currentTime, bufferedEnd, event = 'poll', playing = true) => ({
    at,
    currentTime,
    bufferedEnd,
    playing,
    event,
});

test('直近30秒で低バッファの waiting が3回なら fallback 対象になる', () => {
    const samples = [
        sample(1_000, 10, 10, 'waiting'),
        sample(11_000, 10.1, 10.2, 'waiting'),
        sample(21_000, 10.2, 10.4, 'waiting'),
    ];

    assert.deepEqual(detectPlaybackStall(samples, 21_000), {
        shouldFallback: true,
        reason: 'repeated-waiting',
    });
});

test('5秒以上 currentTime が進まずバッファが少ないと fallback 対象になる', () => {
    const samples = [sample(1_000, 20, 20.5), sample(6_000, 20.1, 20.4)];

    assert.deepEqual(detectPlaybackStall(samples, 6_000), {
        shouldFallback: true,
        reason: 'no-progress',
    });
});

test('waiting が少ない、または十分なバッファがあれば fallback しない', () => {
    const samples = [
        sample(1_000, 10, 15, 'waiting'),
        sample(11_000, 15, 20, 'waiting'),
        sample(21_000, 20, 25, 'timeupdate'),
    ];

    assert.deepEqual(detectPlaybackStall(samples, 21_000), {
        shouldFallback: false,
        reason: null,
    });
});

test('過去に waiting が3回あっても最新のバッファが十分なら fallback しない', () => {
    const samples = [
        sample(1_000, 10, 10, 'waiting'),
        sample(11_000, 10.1, 10.2, 'waiting'),
        sample(21_000, 10.2, 10.4, 'waiting'),
        sample(22_000, 10.5, 15, 'poll'),
    ];

    assert.deepEqual(detectPlaybackStall(samples, 22_000), {
        shouldFallback: false,
        reason: null,
    });
});

test('観測窓より古い waiting と未来の観測は判定に使わない', () => {
    const samples = [sample(0, 10, 10, 'waiting'), sample(31_000, 10, 10, 'waiting'), sample(32_000, 10, 10, 'waiting')];

    assert.equal(detectPlaybackStall(samples, 32_000).shouldFallback, false);
});

test('一時停止中の無進行は回線不足と判定しない', () => {
    const samples = [sample(1_000, 20, 20, 'poll', false), sample(6_000, 20, 20, 'poll', false)];

    assert.deepEqual(detectPlaybackStall(samples, 6_000), {
        shouldFallback: false,
        reason: null,
    });
});

test('Resource Timing の複数サンプルから実効帯域を中央値で推定する', () => {
    const samples = [
        { at: 1_000, bytes: 100_000, durationMs: 1_000 },
        { at: 2_000, bytes: 200_000, durationMs: 1_000 },
        { at: 3_000, bytes: 180_000, durationMs: 1_000 },
    ];

    assert.equal(estimatePlaybackBandwidthKbps(samples, 3_000), 1440);
});

test('実効帯域が足りないとき bitrate に収まる段へ一度に降格する', () => {
    const profiles = [
        { id: '1080p', videoBitrate: 6000 },
        { id: '720p', videoBitrate: 3000 },
        { id: '480p', videoBitrate: 900 },
        { id: '360p', videoBitrate: 500 },
    ];
    const samples = [
        { at: 1_000, bytes: 200_000, durationMs: 1_000 },
        { at: 2_000, bytes: 200_000, durationMs: 1_000 },
    ];

    assert.deepEqual(selectThroughputFallback('1080p', ['720p', '480p', '360p'], profiles, samples, 2_000), {
        profileId: '480p',
        bandwidthKbps: 1600,
    });
});

test('帯域サンプルが1件だけなら従来の1段降格へ戻せる', () => {
    assert.deepEqual(
        selectThroughputFallback(
            '1080p',
            ['720p'],
            [{ id: '1080p', videoBitrate: 6000 }, { id: '720p', videoBitrate: 3000 }],
            [{ at: 1_000, bytes: 200_000, durationMs: 1_000 }],
            1_000,
        ),
        { profileId: null, bandwidthKbps: null },
    );
});

test('Resource Timing が取れないときは帯域による直接降格をしない', () => {
    assert.deepEqual(
        selectThroughputFallback(
            '1080p',
            ['720p', '480p'],
            [{ id: '1080p', videoBitrate: 6000 }, { id: '720p', videoBitrate: 3000 }, { id: '480p', videoBitrate: 900 }],
            [],
            10_000,
        ),
        { profileId: null, bandwidthKbps: null },
    );
});

test('明示画質を選択中は自動画質 fallback を許可しない', () => {
    assert.equal(canAutoFallback(false, false), false);
    assert.equal(canAutoFallback(true, false), true);
    assert.equal(canAutoFallback(true, true), false);
});
