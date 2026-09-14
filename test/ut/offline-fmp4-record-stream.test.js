'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const OfflineFmp4RecordStream = require('../../dist/model/service/stream/llhls/OfflineFmp4RecordStream').default;

const box = (type, body) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(header.length + body.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, body]);
};

const audioInit = () => {
    const entry = box('mp4a', Buffer.alloc(0));
    const stsdBody = Buffer.concat([Buffer.alloc(8), entry]);
    const stsd = box('stsd', stsdBody);
    const stbl = box('stbl', stsd);
    const minf = box('minf', stbl);
    const mdia = box('mdia', minf);
    const trak = box('trak', mdia);
    return Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov', trak)]);
};

test('パッケージャのセグメントを EOF 前に逐次レコードへ出す', async () => {
    const source = new PassThrough();
    const packager = new PassThrough();
    const output = new OfflineFmp4RecordStream(source, packager);
    const records = [];
    let ended = false;
    output.on('data', record => records.push(record));
    output.on('end', () => { ended = true; });
    packager.emit('init', audioInit());
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(records.map(record => record.readUInt8(0)), [1, 2]);
    packager.emit('segment', { data: Buffer.from('segment'), duration: 6, parts: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(records[2].readUInt8(0), 3);
    assert.equal(records[2].readUInt32BE(4), 0);
    assert.equal(records[2].readUInt32BE(8), 6000);
    assert.equal(ended, false);
    packager.emit('finish');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(records[3].readUInt8(0), 0xff);
    assert.equal(records[3].readUInt32BE(4), 3);
    assert.equal(ended, true);
});
