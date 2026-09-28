'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const RecordingSourceLeaseManager = require('../../dist/model/operator/recording/RecordingSourceLeaseManager').default;

test('2 秒分の BS4K 相当データが詰まっても共有枝は失敗しない', async () => {
    const manager = new RecordingSourceLeaseManager();
    const payload = Buffer.alloc(8 * 1024 * 1024, 0x47);
    const source = new Readable({ read() {} });
    const [active, stalled] = await Promise.all([
        manager.acquire(1, async () => source),
        manager.acquire(1, async () => source),
    ]);
    let receivedBytes = 0;
    active.stream.on('data', chunk => (receivedBytes += chunk.length));
    stalled.stream.on('error', () => {});
    for (let offset = 0; offset < payload.length; offset += 16 * 1024) {
        source.push(payload.subarray(offset, offset + 16 * 1024));
        await new Promise(resolve => setImmediate(resolve));
    }
    source.push(null);
    const completed = await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(false), 3000);
        active.stream.once('end', () => {
            clearTimeout(timeout);
            resolve(true);
        });
    });
    source.destroy();
    assert.equal(completed, true, '停止枝が共有上流の終了を止めない');
    assert.equal(receivedBytes, payload.length);
    assert.equal(stalled.stream.destroyed, false);
    active.release();
    stalled.release();
});
