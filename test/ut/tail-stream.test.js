'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const container = require('../../dist/model/ModelContainer').default;
const { createReadStream, shouldWaitForTailGrowth } = require('../../dist/lib/TailStream');

test('録画継続中は上限内の無成長を許し、状態終了または上限到達で閉じる', () => {
    assert.equal(shouldWaitForTailGrowth(true, 1000, 60_000), true);
    assert.equal(shouldWaitForTailGrowth(false, 1000, 60_000), false);
    assert.equal(shouldWaitForTailGrowth(true, 60_000, 60_000), false);
});

test('非同期の録画状態が false になった後、末尾 stream は約1秒で EOF になる', async t => {
    const logger = {
        getLogger: () => ({
            stream: { error: () => {} },
            system: { error: () => {} },
        }),
    };
    if (container.isBound('ILoggerModel')) container.unbind('ILoggerModel');
    container.bind('ILoggerModel').toConstantValue(logger);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tail-stream-test-'));
    const filePath = path.join(directory, 'recording.ts');
    await fs.writeFile(filePath, Buffer.alloc(188, 0x47));
    t.after(async () => {
        await fs.rm(directory, { recursive: true, force: true });
        container.unbind('ILoggerModel');
    });

    let isRecording = true;
    const source = createReadStream(filePath, {
        shouldKeepWaiting: async () => isRecording,
        maxIdleMs: 60_000,
    });
    source.resume();
    let ended = false;
    source.once('end', () => (ended = true));
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(ended, false, '録画中は末尾で待つ');
    isRecording = false;
    const stoppedAt = Date.now();
    await new Promise(resolve => source.once('end', resolve));
    assert.ok(Date.now() - stoppedAt <= 1200);
});
