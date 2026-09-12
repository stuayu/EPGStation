'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    getBufferedAheadSeconds,
    isInitialPlaybackBufferReady,
} = require('../../dist/util/PlaybackStartBuffer');

test('初回再生前の前方バッファ秒数を計算する', () => {
    assert.equal(getBufferedAheadSeconds(10, 17.5), 7.5);
    assert.equal(getBufferedAheadSeconds(10, null), null);
});

test('必要量未満の初回バッファでは再生を開始しない', () => {
    assert.equal(isInitialPlaybackBufferReady(10, 17.9, null, 8), false);
    assert.equal(isInitialPlaybackBufferReady(10, 18, null, 8), true);
});

test('短い録画は終端までバッファできれば再生を開始する', () => {
    assert.equal(isInitialPlaybackBufferReady(10, 14, 14, 8), true);
});
