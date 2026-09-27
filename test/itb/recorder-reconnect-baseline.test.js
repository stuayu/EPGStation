'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { MirakurunRecordingStub, sendThenReset } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');

test('recorder reconnect baseline: ECONNRESET leaves one partial recording before notification (Phase 4 changes this)', async t => {
    const stub = new MirakurunRecordingStub([
        sendThenReset(30, 73, { conn: 1, delayMs: 300 }),
    ]);
    const harness = new RecorderHarness(stub, { recording: { errorFastRetryIntervalMs: 1000, firstDataTimeoutMs: 1000 } });
    await harness.start();
    t.after(() => harness.cleanup());

    let resolveFailure;
    const failed = new Promise(resolve => { resolveFailure = resolve; });
    const original = harness.recorder.recordingEvent.emitRecordingFailed;
    harness.recorder.recordingEvent.emitRecordingFailed = (...args) => {
        original(...args);
        resolveFailure();
    };

    const now = Date.now();
    const reserve = {
        id: 99001, programId: null, channelId: 12345, channelType: 'GR', channel: 'test',
        startAt: now, endAt: now + 8_000, isTimeSpecified: true, isConflict: false,
        isFollowingSchedule: false, isEventRelay: false, allowEndLack: false,
        isSkip: false, isOverlap: false, name: null, halfWidthName: null,
    };
    harness.recorder.setTimer(reserve, true);
    let timeoutId;
    try {
        await Promise.race([failed, new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`recording did not fail; requests=${JSON.stringify(stub.requests)} recorded=${harness.recorded.length}`)), 5000);
        })]);
    } finally {
        clearTimeout(timeoutId);
    }

    const files = (await fs.promises.readdir(harness.tempDir)).sort();
    const sizes = await Promise.all(files.map(async file => ({ name: file, size: (await fs.promises.stat(`${harness.tempDir}/${file}`)).size })));
    assert.equal(harness.recorded.length, 1);
    assert.equal(files.length, 1);
    assert.equal(harness.events.start.length, 1);
    assert.equal(files[0], 'baseline.ts');
    assert.equal(sizes[0].size, 5713);
    assert.equal(sizes[0].size % 188, 73);
    assert.equal(harness.events.failed.length, 1);
    assert.equal(harness.events.finish.length, 1);
    assert.equal(harness.events.failed[0][0].id, reserve.id);
    const streams = stub.requests.filter(request => request.url.includes('/stream'));
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, '/api/services/12345/stream?decode=1');
    t.diagnostic(JSON.stringify({ recorded: harness.recorded.length, files: sizes.map(item => ({ ...item, mod188: item.size % 188 })), failed: harness.events.failed.length, finish: harness.events.finish.length, priorities: streams.map(request => request.priority) }));
});
