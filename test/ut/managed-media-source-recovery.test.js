'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isManagedMediaSourceBufferStarving,
    resolveManagedMediaSourceRecoveryPosition,
} = require('../../dist/util/ManagedMediaSourceRecovery');

test('MMS停止後の再取得位置は現在の絶対再生位置で、先頭へ戻さない', () => {
    assert.equal(resolveManagedMediaSourceRecoveryPosition(23.2), 23.2);
    assert.equal(resolveManagedMediaSourceRecoveryPosition(23.2, true), null);
    assert.equal(resolveManagedMediaSourceRecoveryPosition(Number.NaN), null);
});

test('MMS停止中に前方バッファが8秒以下なら枯渇扱いにする', () => {
    assert.equal(isManagedMediaSourceBufferStarving(true, 27, 35), true);
    assert.equal(isManagedMediaSourceBufferStarving(true, 27, 35.1), false);
    assert.equal(isManagedMediaSourceBufferStarving(false, 27, 27), false);
    assert.equal(isManagedMediaSourceBufferStarving(true, 27, null), true);
});
