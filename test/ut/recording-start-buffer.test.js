'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordingStartBuffer = require('../../dist/model/operator/recording/RecordingStartBuffer').default;

test('録画開始待ちバッファは上限を超えた古い TS だけを捨てる', () => {
    const packet = value => Buffer.alloc(188, value);
    const buffer = new RecordingStartBuffer(188 * 2 + 100);
    buffer.push(Buffer.concat([packet(1), packet(2)]));
    buffer.push(packet(3));
    assert.equal(buffer.byteLength, 188 * 2);
    assert.deepEqual(Buffer.concat(buffer.drain()), Buffer.concat([packet(2), packet(3)]));
    assert.equal(buffer.byteLength, 0);
});

test('録画開始待ちバッファはチャンク順を保持する', () => {
    const buffer = new RecordingStartBuffer(188);
    buffer.push(Buffer.from('12'));
    buffer.push(Buffer.from('345'));
    assert.deepEqual(buffer.drain(), [Buffer.from('12'), Buffer.from('345')]);
});

test('既定の 8 MiB 上限を超えても TS packet 境界から開始する', () => {
    const packet = value => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, value)]);
    const maxPackets = Math.floor(RecordingStartBuffer.DEFAULT_MAX_BYTES / 188);
    const buffer = new RecordingStartBuffer();
    buffer.push(Buffer.concat(Array.from({ length: maxPackets + 1 }, (_, index) => packet(index & 0xff))));
    const result = Buffer.concat(buffer.drain());
    assert.equal(result.length <= RecordingStartBuffer.DEFAULT_MAX_BYTES, true);
    assert.equal(result.length % 188, 0);
    assert.equal(result[0], 0x47);
});
