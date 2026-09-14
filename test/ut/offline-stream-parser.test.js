'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const OfflineStreamParser = require('../../dist/util/OfflineStreamParser').default;
const { createOfflineEndRecord, createOfflineInitRecord, createOfflineMasterRecord, createOfflineSegmentRecord, getOfflineStreamMagic } = require('../../dist/util/OfflineStreamProtocol');

const createPayload = () => {
    const metadata = Buffer.from(JSON.stringify({ videoFileId: 7, fileSize: 123, duration: 12, profile: 'recorded-encoded-hls-0', formatVersion: 2 }));
    const init = Buffer.from('init');
    const master = Buffer.from('#EXTM3U');
    const segment = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    return Buffer.concat([
        getOfflineStreamMagic(),
        Buffer.from([0, 0, 0, metadata.length]),
        metadata,
        createOfflineInitRecord('single', init),
        createOfflineMasterRecord(master),
        createOfflineSegmentRecord('single', 0, 6000, segment),
        createOfflineEndRecord(3),
    ]);
};

test('任意位置で分割されたオフライン保存ストリームを復元する', () => {
    const parser = new OfflineStreamParser();
    const payload = createPayload();
    const events = [];
    for (let i = 0; i < payload.length; i += 3) events.push(...parser.push(payload.subarray(i, Math.min(i + 3, payload.length))));
    parser.finish();
    assert.equal(events[0].type, 'metadata');
    assert.equal(events[1].type, 'init');
    assert.equal(events[2].type, 'master');
    assert.deepEqual([...events[3].segment.data], [0x00, 0x01, 0x02, 0x03]);
    assert.deepEqual(events[4], { type: 'end', recordCount: 3 });
});

test('終端レコードが欠落したストリームを拒否する', () => {
    const parser = new OfflineStreamParser();
    const payload = createPayload().subarray(0, -8);
    parser.push(payload);
    assert.throws(() => parser.finish(), /途中で終了/);
});

test('終端レコードはセグメント件数を持つ', () => {
    const record = createOfflineEndRecord(3);
    assert.equal(record.readUInt8(0), 0xff);
    assert.equal(record.readUInt32BE(4), 3);
});

test('大きなチャンクでもパーサーはレコード処理後に保持を解放する', () => {
    const parser = new OfflineStreamParser();
    const metadata = Buffer.from(JSON.stringify({ videoFileId: 7, fileSize: 8192, duration: 12, profile: 'hls', formatVersion: 2 }));
    const segment = Buffer.alloc(4096, 0x42);
    const payload = Buffer.concat([
        getOfflineStreamMagic(),
        Buffer.from([0, 0, 0, metadata.length]),
        metadata,
        createOfflineInitRecord('single', Buffer.from('init')),
        createOfflineMasterRecord(Buffer.from('#EXTM3U')),
        createOfflineSegmentRecord('single', 0, 6000, segment),
        createOfflineSegmentRecord('single', 1, 6000, segment),
        createOfflineEndRecord(4),
    ]);
    const events = parser.push(payload);
    parser.finish();
    assert.equal(events.filter(event => event.type === 'segment').length, 2);
    assert.equal(parser.getMaxPendingBytes(), 0);
});
