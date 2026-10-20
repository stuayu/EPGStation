'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateRecordedStreamStartByte } = require('../../dist/util/RecordedStreamByteOffset');

test('録画 TS の開始位置を 188 byte のパケット境界へ丸める', () => {
    // 8000 bit/s を 1 秒読むと 1000 byte。188 byte 境界の 940 byte へ丸める。
    assert.equal(calculateRecordedStreamStartByte(8000, 1, 100000), 940);
});

test('録画 TS の開始位置を 0 未満にせず 0 へクランプする', () => {
    assert.equal(calculateRecordedStreamStartByte(8000, -10, 100000), 0);
});

test('再生位置 0 以下はメタデータ不明でも先頭から読む', () => {
    assert.equal(calculateRecordedStreamStartByte(Number.NaN, 0, 100000), 0);
    assert.equal(calculateRecordedStreamStartByte(8000, -1, 100000), 0);
});

test('不正なビットレートは先頭から読む', () => {
    for (const bitRate of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(calculateRecordedStreamStartByte(bitRate, 10, 100000), 0);
    }
});

test('不正なファイルサイズは NaN の開始位置にしない', () => {
    assert.equal(calculateRecordedStreamStartByte(8000, 10, Number.NaN), 0);
    assert.equal(calculateRecordedStreamStartByte(8000, 10, Number.POSITIVE_INFINITY), 0);
});

test('録画 TS の開始位置をファイル長以内へクランプしてから境界へ丸める', () => {
    // ファイル長 1000 byte を超える要求は 1000 byte へ抑え、940 byte から読む。
    assert.equal(calculateRecordedStreamStartByte(8000, 10, 1000), 940);
});

test('録画 TS の開始位置は前回の再生位置に依存しない', () => {
    const forward = calculateRecordedStreamStartByte(8000, 10, 100000);
    const backward = calculateRecordedStreamStartByte(8000, 1, 100000);

    assert.equal(forward, 9964);
    assert.equal(backward, 940);
    assert.equal(calculateRecordedStreamStartByte(8000, 1, 100000), backward);
});

test('再生位置が NaN / Infinity のときは先頭から読む', () => {
    assert.strictEqual(calculateRecordedStreamStartByte(16_000_000, Number.NaN, 1_000_000_000), 0);
    assert.strictEqual(calculateRecordedStreamStartByte(16_000_000, Number.POSITIVE_INFINITY, 1_000_000_000), 0);
});
