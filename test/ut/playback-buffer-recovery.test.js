'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    resolvePlaybackBufferRecoveryTarget,
    PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS,
} = require('../../dist/util/PlaybackBufferRecovery');

const buffered = [{ start: 2.492, end: 10 }];

test('再接続後に currentTime が先頭バッファより手前で進まなければ先頭へ寄せる', () => {
    assert.equal(
        resolvePlaybackBufferRecoveryTarget(0, buffered, 2, PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS),
        2.492,
    );
});

test('再生データがまだ読めない間は先頭へ寄せない', () => {
    assert.equal(resolvePlaybackBufferRecoveryTarget(0, buffered, 1, PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS), null);
});

test('無進行の確認前は正常再生を巻き戻さない', () => {
    assert.equal(resolvePlaybackBufferRecoveryTarget(0, buffered, 2, PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS - 1), null);
});

test('currentTime がバッファ範囲内なら寄せない', () => {
    assert.equal(resolvePlaybackBufferRecoveryTarget(3, buffered, 2, PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS), null);
});

test('空範囲や不正な範囲は寄せない', () => {
    assert.equal(resolvePlaybackBufferRecoveryTarget(0, [], 2, PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS), null);
    assert.equal(resolvePlaybackBufferRecoveryTarget(0, [{ start: 2, end: 2 }], 2, PLAYBACK_BUFFER_RECOVERY_MIN_STALL_MS), null);
});
