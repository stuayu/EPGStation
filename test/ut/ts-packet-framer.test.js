'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const TsPacketFramer = require('../../dist/model/operator/recording/TsPacketFramer').default;

const packet = value => {
    const out = Buffer.alloc(188, value);
    out[0] = 0x47;
    return out;
};

test('接続先頭のゴミを捨て、分割入力から完全パケットだけ返す', () => {
    const framer = new TsPacketFramer();
    const input = Buffer.concat([Buffer.from([1, 2, 3]), packet(1), packet(2), packet(3)]);
    assert.equal(framer.push(input.subarray(0, 300)), null);
    const actual = framer.push(input.subarray(300));
    assert.deepEqual(actual, Buffer.concat([packet(1), packet(2), packet(3)]));
    assert.equal(actual.length % 188, 0);
});

test('途中の同期喪失から再同期し、不完全末尾は reset で破棄する', () => {
    const framer = new TsPacketFramer();
    assert.deepEqual(framer.push(Buffer.concat([packet(1), packet(2), packet(3)])), Buffer.concat([packet(1), packet(2), packet(3)]));
    const actual = framer.push(Buffer.concat([Buffer.alloc(188, 9), packet(4), packet(5), packet(6), packet(7).subarray(0, 50)]));
    assert.deepEqual(actual, Buffer.concat([packet(4), packet(5), packet(6)]));
    assert.equal(framer.reset(), 50);
});
