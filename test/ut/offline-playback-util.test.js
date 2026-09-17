'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    calculateOfflineOriginalOffset,
    createOfflineOriginalOffsetUrl,
    isOfflinePositionBuffered,
} = require('../../dist/util/OfflinePlaybackUtil');

test('オフライン元 TS の offset を時間比から188バイト境界へ変換する', () => {
    assert.equal(calculateOfflineOriginalOffset(500, 1880, 1000), 940);
    assert.equal(calculateOfflineOriginalOffset(-1, 1880, 1000), 0);
    assert.equal(calculateOfflineOriginalOffset(1001, 1880, 1000), 1692);
});

test('オフライン元 TS の offset URL は既存 offset を置き換える', () => {
    assert.equal(createOfflineOriginalOffsetUrl('/local/offline/1/g/original.ts', 376), '/local/offline/1/g/original.ts?offset=376');
    assert.equal(createOfflineOriginalOffsetUrl('/local/offline/1/g/original.ts?offset=188', 564), '/local/offline/1/g/original.ts?offset=564');
});

test('オフライン元 TS のシークは絶対位置が buffered 範囲内のときだけ通常 seek にする', () => {
    const buffered = [{ start: 0.4, end: 184.2 }];
    assert.equal(isOfflinePositionBuffered(900, 720, buffered), true);
    assert.equal(isOfflinePositionBuffered(904.3, 720, buffered), false);
    assert.equal(isOfflinePositionBuffered(700, 720, buffered), false);
});
