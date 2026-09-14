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

test('drain 待ち中にクライアントが切断したら待ちを解き、次のレコードを読み出さない', async () => {
    const writes = [];
    const listeners = { drain: [], close: [], error: [] };
    let pulls = 0;
    const response = {
        write(value) {
            writes.push(value.toString());
            return false;
        },
        once(event, listener) {
            listeners[event].push(listener);
        },
        removeListener(event, listener) {
            listeners[event] = listeners[event].filter(item => item !== listener);
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
    // 切断後は drain が二度と来ない。close で待ちが解けないと transfer が永久に保留される
    listeners.close.shift()();
    await transfer;
    assert.deepEqual(writes, ['record-1']);
    assert.equal(pulls, 1);
    assert.equal(listeners.drain.length, 0);
    assert.equal(listeners.error.length, 0);
});

test('切断済みと判定されたら次のレコードを書き込まない', async () => {
    const writes = [];
    let closed = false;
    const response = {
        write(value) {
            writes.push(value.toString());
            closed = true;
            return true;
        },
        once() {},
    };
    async function* source() {
        yield Buffer.from('record-1');
        yield Buffer.from('record-2');
    }
    await pipeOfflineRecords(response, source(), () => closed);
    assert.deepEqual(writes, ['record-1']);
});
