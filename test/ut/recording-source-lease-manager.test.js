'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { PassThrough } = require('node:stream');
const RecordingSourceLeaseManager = require('../../dist/model/operator/recording/RecordingSourceLeaseManager').default;

test('同じ channelId の lease は同じ上流から独立した枝を受け取る', async () => {
    const manager = new RecordingSourceLeaseManager();
    const upstream = new PassThrough();
    let opens = 0;
    const open = async () => {
        opens++;
        return upstream;
    };
    const [a, b] = await Promise.all([manager.acquire(1, open), manager.acquire(1, open)]);
    const aData = [];
    const bData = [];
    a.stream.on('data', chunk => aData.push(chunk.toString()));
    b.stream.on('data', chunk => bData.push(chunk.toString()));

    upstream.write('first');
    a.release();
    upstream.write('second');

    assert.equal(opens, 1);
    assert.notEqual(a.stream, b.stream);
    assert.deepEqual(aData, ['first']);
    assert.deepEqual(bData, ['first', 'second']);
    assert.equal(upstream.destroyed, false);
    b.release();
    assert.equal(upstream.destroyed, true);
});

test('同時 acquire は上流 open を一度にまとめ、release は冪等', async () => {
    const manager = new RecordingSourceLeaseManager();
    const upstream = new PassThrough();
    let opens = 0;
    const open = async () => {
        opens++;
        await new Promise(resolve => setImmediate(resolve));
        return upstream;
    };
    const [a, b] = await Promise.all([manager.acquire(2, open), manager.acquire(2, open)]);
    a.release();
    a.release();
    assert.equal(opens, 1);
    assert.equal(upstream.destroyed, false);
    b.release();
    assert.equal(upstream.destroyed, true);
});

test('上流 error は全 lease 枝へ伝わり、次の acquire で新しい上流を開く', async () => {
    const manager = new RecordingSourceLeaseManager();
    const upstream = new PassThrough();
    const reason = new Error('ECONNRESET');
    let opens = 0;
    const open = async () => {
        opens++;
        return opens === 1 ? upstream : new PassThrough();
    };
    const a = await manager.acquire(3, open);
    const b = await manager.acquire(3, open);
    const received = [];
    a.stream.on('error', error => received.push(error));
    b.stream.on('error', error => received.push(error));

    upstream.destroy(reason);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(received.length, 2);
    assert.equal(received[0], reason);
    assert.equal(received[1], reason);
    const c = await manager.acquire(3, open);
    assert.equal(opens, 2);
    c.release();
    a.release();
    b.release();
});

test('上流の正常終了は枝へ EOF を送り、共有表から外す', async () => {
    const manager = new RecordingSourceLeaseManager();
    const upstream = new PassThrough();
    let opens = 0;
    const open = async () => {
        opens++;
        return opens === 1 ? upstream : new PassThrough();
    };
    const a = await manager.acquire(4, open);
    const ended = new Promise(resolve => a.stream.once('end', resolve));
    a.stream.resume();
    upstream.end('done');
    await ended;
    const b = await manager.acquire(4, open);
    assert.equal(opens, 2);
    a.release();
    b.release();
});

test('compatibilityKey の違いは別上流を使う', async () => {
    const manager = new RecordingSourceLeaseManager();
    const upstreams = [];
    const open = async () => {
        const upstream = new PassThrough();
        upstreams.push(upstream);
        return upstream;
    };
    const a = await manager.acquire(5, open, 'priority=0;decode=false');
    const b = await manager.acquire(5, open, 'priority=1;decode=false');
    const c = await manager.acquire(5, open, 'priority=0;decode=true');
    const d = await manager.acquire(5, open, 'priority=0;decode=false');
    assert.equal(upstreams.length, 3);
    const e = await manager.acquire(5, open, 'priority=0;decode=false');
    assert.equal(upstreams.length, 3);
    a.release();
    b.release();
    c.release();
    d.release();
    e.release();
});
