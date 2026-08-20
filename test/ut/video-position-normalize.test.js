'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

// VideoContainer.normalizePosition と同じ丸め規則。
// クライアントは Vue SFC のため直接 require できないので、規則をここで固定する。
// (API の UpdatePlaybackPositionOption は position: minimum 0 / duration <= position を許さない)
const normalizePosition = (current, duration) => {
    if (Number.isFinite(current) === false) return 0;
    return Math.min(Math.max(0, current), duration);
};

test('通常の再生位置はそのまま通す', () => {
    assert.equal(normalizePosition(123.4, 1800), 123.4);
});

test('負の再生位置は 0 に丸める (400 must be >= 0 の原因)', () => {
    assert.equal(normalizePosition(-0.5, 1800), 0);
    assert.equal(normalizePosition(-1000, 1800), 0);
});

test('動画長を超える位置は動画長に丸める', () => {
    assert.equal(normalizePosition(2000, 1800), 1800);
});

test('NaN / Infinity は 0 に丸める', () => {
    assert.equal(normalizePosition(Number.NaN, 1800), 0);
    assert.equal(normalizePosition(Number.POSITIVE_INFINITY, 1800), 0);
    assert.equal(normalizePosition(Number.NEGATIVE_INFINITY, 1800), 0);
});

test('境界値', () => {
    assert.equal(normalizePosition(0, 1800), 0);
    assert.equal(normalizePosition(1800, 1800), 1800);
});
