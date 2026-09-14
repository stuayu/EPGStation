'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { pipeOfflineRecords } = require('../../dist/util/OfflineResponseWriter');

test('HTTP の drain 待ち中は次のレコードを読み出さない', async () => {
    const writes = [];
    const drains = [];
    let pulls = 0;
    const response = {
        write(value) {
            writes.push(value.toString());
            return writes.length !== 1;
        },
        once(_event, listener) {
            drains.push(listener);
        },
    };
    async function* source() {
        pulls += 1;
        yield Buffer.from('record-1');
        pulls += 1;
        yield Buffer.from('record-2');
    }
    const transfer = pipeOfflineRecords(response, source());
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes, ['record-1']);
    assert.equal(pulls, 1);
    drains.shift()();
    await transfer;
    assert.deepEqual(writes, ['record-1', 'record-2']);
    assert.equal(pulls, 2);
});
