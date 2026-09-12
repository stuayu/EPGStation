'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizePlaybackPosition } = require('../../dist/model/api/video/PlaybackPosition');

test('再生位置と視聴状態を境界値で正規化する', () => {
    const cases = [
        [{ position: 0, duration: 100 }, { position: 0, duration: 100, status: 'unwatched' }],
        [{ position: 89, duration: 100 }, { position: 89, duration: 100, status: 'watching' }],
        [{ position: 90, duration: 100 }, { position: 90, duration: 100, status: 'watched' }],
        [{ position: 120.4, duration: 100.2 }, { position: 100, duration: 100, status: 'watched' }],
    ];
    for (const [input, expected] of cases) assert.deepEqual(normalizePlaybackPosition(input), expected);
});

test('不正な再生位置を入力エラーとして分類する', () => {
    const invalidCases = [
        [{ position: -1, duration: 1 }, 'PlaybackPositionIsInvalid'],
        [{ position: Number.NaN, duration: 1 }, 'PlaybackPositionIsInvalid'],
        [{ position: Number.POSITIVE_INFINITY, duration: 1 }, 'PlaybackPositionIsInvalid'],
        [{ position: 1, duration: 0 }, 'PlaybackDurationIsInvalid'],
        [{ position: 1, duration: -1 }, 'PlaybackDurationIsInvalid'],
        [{ position: 1, duration: Number.NaN }, 'PlaybackDurationIsInvalid'],
        [{ position: 1, duration: Number.POSITIVE_INFINITY }, 'PlaybackDurationIsInvalid'],
        [{ position: 1, duration: 0.4 }, 'PlaybackDurationIsInvalid'],
    ];
    for (const [input, message] of invalidCases) assert.throws(() => normalizePlaybackPosition(input), new RegExp(message));
});
