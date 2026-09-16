'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
    ADTS_SYNCWORD_PATCH,
    ADTS_SYNCWORD_SOURCE,
    patchMpegtsAdtsParser,
} = require('../../client/mpegtsAdtsPatch.js');

const mpegtsPath = path.resolve(__dirname, '../../client/node_modules/mpegts.js/dist/mpegts.js');

function loadPatchedScanner() {
    const original = `function findNextSyncwordOffset(e){for(var t=e,i=this.data_;;){if(t+7>=i.byteLength)return this.eof_flag_=!0,i.byteLength;${ADTS_SYNCWORD_SOURCE}}}`;
    const patched = patchMpegtsAdtsParser(original);
    return vm.runInNewContext(`(${patched})`);
}

function makeAdtsFrame(payloadLength = 8) {
    const frameLength = 7 + payloadLength;
    const frame = Buffer.alloc(frameLength, 0);
    frame[0] = 0xff;
    frame[1] = 0xf1;
    frame[2] = 0x4c; // AAC LC, 48kHz, stereo
    frame[3] = 0x80 | ((frameLength >>> 11) & 0x03);
    frame[4] = (frameLength >>> 3) & 0xff;
    frame[5] = (frameLength & 0x07) << 5;
    frame[6] = 0xfc;
    return frame;
}

test('mpegts.js dist へ ADTS 偽同期対策を1回だけ適用できる', () => {
    const source = fs.readFileSync(mpegtsPath, 'utf8');
    const patched = patchMpegtsAdtsParser(source);
    assert.equal(source.split(ADTS_SYNCWORD_SOURCE).length - 1, 1);
    assert.notEqual(patched, source);
    assert.equal(patched.split(ADTS_SYNCWORD_PATCH).length - 1, 1);
    assert.equal(patched.includes(ADTS_SYNCWORD_SOURCE), false);
});

test('ADTS 置換元が無い場合は依存更新として失敗する', () => {
    assert.throws(() => patchMpegtsAdtsParser('no matching mpegts source'), /target count must be 1/);
});

test('偽 ADTS 同期語を飛ばして正規フレームをすべて拾う', () => {
    const first = makeAdtsFrame();
    const fake = Buffer.from([0xff, 0xf1, 0x44, 0x80, 0x00, 0xe0, 0xfc, 0x11, 0x22]);
    const second = makeAdtsFrame();
    const third = makeAdtsFrame();
    const data = Buffer.concat([Buffer.from([0x12, 0x34]), fake, Buffer.from([0x56]), first, second, third]);
    const scanner = loadPatchedScanner();
    const offsets = [];
    let offset = 0;
    while (offset < data.length) {
        const found = scanner.call({ data_: data }, offset);
        if (found >= data.length) break;
        offsets.push(found);
        const frameLength = ((data[found + 3] & 0x03) << 11) | (data[found + 4] << 3) | (data[found + 5] >>> 5);
        offset = found + frameLength;
    }
    const firstOffset = 2 + fake.length + 1;
    assert.deepEqual(offsets, [firstOffset, firstOffset + first.length, firstOffset + first.length + second.length]);
});

test('次ヘッダが末尾1から3 byteしかない正規フレームを捨てない', () => {
    const frame = makeAdtsFrame();
    for (const trailingLength of [1, 2, 3]) {
        const data = Buffer.concat([frame, Buffer.from([0xff, 0xf1, 0x4c]).subarray(0, trailingLength)]);
        const scanner = loadPatchedScanner();
        assert.equal(scanner.call({ data_: data }, 0), 0);
    }
});
