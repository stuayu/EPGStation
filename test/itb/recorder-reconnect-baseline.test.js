'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { MirakurunRecordingStub, sendThenReset, sendAndHold } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');

test('ECONNRESET after first data is recorded as a partial finish', async t => {
    const stub = new MirakurunRecordingStub([sendThenReset(30, 73, { conn: 1, delayMs: 300 })]);
    const harness = new RecorderHarness(stub, {
        recording: { errorFastRetryIntervalMs: 1000, firstDataTimeoutMs: 1000 },
    });
    await harness.start();
    t.after(() => harness.cleanup());

    let resolveFailure;
    const failed = new Promise(resolve => {
        resolveFailure = resolve;
    });
    const original = harness.recorder.recordingEvent.emitFinishRecording;
    harness.recorder.recordingEvent.emitFinishRecording = (...args) => {
        original(...args);
        resolveFailure();
    };

    const now = Date.now();
    const reserve = {
        id: 99001,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'test',
        startAt: now,
        endAt: now + 8_000,
        isTimeSpecified: true,
        isConflict: false,
        isFollowingSchedule: false,
        isEventRelay: false,
        allowEndLack: false,
        isSkip: false,
        isOverlap: false,
        name: null,
        halfWidthName: null,
    };
    harness.recorder.setTimer(reserve, true);
    let timeoutId;
    try {
        await Promise.race([
            failed,
            new Promise((_, reject) => {
                timeoutId = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `recording did not fail; requests=${JSON.stringify(stub.requests)} recorded=${harness.recorded.length}`,
                            ),
                        ),
                    5000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timeoutId);
    }

    const files = (await fs.promises.readdir(harness.tempDir)).sort();
    const sizes = await Promise.all(
        files.map(async file => ({ name: file, size: (await fs.promises.stat(`${harness.tempDir}/${file}`)).size })),
    );
    assert.equal(harness.recorded.length, 1);
    assert.equal(files.length, 1);
    assert.equal(harness.events.start.length, 1);
    assert.equal(files[0], 'baseline.ts');
    assert.equal(sizes[0].size, 5713);
    assert.equal(sizes[0].size % 188, 73);
    assert.equal(harness.events.failed.length, 0);
    assert.equal(harness.events.finish.length, 1);
    assert.equal(harness.events.finish[0][1].recordingStatus, 'partial');
    assert.equal(harness.events.finish[0][0].id, reserve.id);
    const streams = stub.requests.filter(request => request.url.includes('/stream'));
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, '/api/services/12345/stream?decode=1');
    t.diagnostic(
        JSON.stringify({
            recorded: harness.recorded.length,
            files: sizes.map(item => ({ ...item, mod188: item.size % 188 })),
            failed: harness.events.failed.length,
            finish: harness.events.finish.length,
            priorities: streams.map(request => request.priority),
        }),
    );
});

test('録画中キャンセルは読取バッファが残っても失敗再試行を出さない', async t => {
    const stub = new MirakurunRecordingStub([sendAndHold(3000)]);
    const harness = new RecorderHarness(stub);
    await harness.start();
    t.after(() => harness.cleanup());
    const now = Date.now();
    const reserve = {
        id: 99002,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'test',
        startAt: now,
        endAt: now + 8000,
        isTimeSpecified: true,
        isConflict: false,
        isFollowingSchedule: false,
        isEventRelay: false,
        allowEndLack: false,
        isSkip: false,
        isOverlap: false,
        name: null,
        halfWidthName: null,
    };
    harness.recorder.setTimer(reserve, true);
    await waitFor(() => harness.events.start.length === 1);
    const source = harness.recorder.stream;
    source.pause();
    source.unshift(Buffer.alloc(188));
    const bufferedBytes = source.readableLength;
    assert.ok(bufferedBytes > 0);
    await harness.recorder.cancel(false);
    assert.equal(harness.events.failed.length, 0);
    await waitFor(() => harness.events.finish.length === 1);
    assert.equal(harness.events.finish.length, 1);
    t.diagnostic(
        JSON.stringify({ bufferedBytes, failed: harness.events.failed.length, finish: harness.events.finish.length }),
    );
});

test('close reason を失う destroy + push(null) でもキャンセル後に二重終了しない', async t => {
    const stub = new MirakurunRecordingStub([sendAndHold(3000)]);
    const harness = new RecorderHarness(stub);
    await harness.start();
    t.after(() => harness.cleanup());
    harness.recordingStreamCreator.markClose = () => {};
    harness.recordingStreamCreator.closeStream = stream => {
        stream.destroy();
        stream.push(null);
    };
    const now = Date.now();
    const reserve = {
        id: 99003,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'test',
        startAt: now,
        endAt: now + 8000,
        isTimeSpecified: true,
        isConflict: false,
        isFollowingSchedule: false,
        isEventRelay: false,
        allowEndLack: false,
        isSkip: false,
        isOverlap: false,
        name: null,
        halfWidthName: null,
    };
    harness.recorder.setTimer(reserve, true);
    await waitFor(() => harness.events.start.length === 1);
    harness.recorder.stream.pause();
    harness.recorder.stream.unshift(Buffer.alloc(188));
    assert.ok(harness.recorder.stream.readableLength > 0);
    await harness.recorder.cancel(false);
    await waitFor(() => harness.events.failed.length > 0 || harness.events.finish.length > 0);
    assert.equal(harness.events.failed.length, 0);
    assert.equal(harness.events.finish.length, 1);
    t.diagnostic(
        JSON.stringify({
            bufferedBytes: harness.recorder.stream?.readableLength ?? 0,
            failed: harness.events.failed.length,
            finish: harness.events.finish.length,
        }),
    );
});

test('onData の addRecorded 例外は reject され、録画状態を戻して開始再試行へ進む', async t => {
    const stub = new MirakurunRecordingStub([sendAndHold(3000), sendAndHold(3000)]);
    const harness = new RecorderHarness(stub, {
        recording: { errorFastRetryIntervalMs: 1000, firstDataTimeoutMs: 1000 },
    });
    await harness.start();
    t.after(() => harness.cleanup());
    let addRecordedCalls = 0;
    harness.recorder.addRecorded = async () => {
        addRecordedCalls++;
        throw new Error('simulated addRecorded failure');
    };
    const now = Date.now();
    const reserve = {
        id: 99004,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'test',
        startAt: now,
        endAt: now + 20_000,
        isTimeSpecified: true,
        isConflict: false,
        isFollowingSchedule: false,
        isEventRelay: false,
        allowEndLack: false,
        isSkip: false,
        isOverlap: false,
        name: null,
        halfWidthName: null,
    };
    harness.recorder.setTimer(reserve, true);
    await waitFor(() => addRecordedCalls > 0 && harness.recorder.prepRetryTimerId !== null);
    assert.equal(harness.recorder.isRecording, false);
    assert.equal(harness.events.failed.length, 0);
    t.diagnostic(
        JSON.stringify({
            retryScheduled: harness.recorder.prepRetryTimerId !== null,
            isRecording: harness.recorder.isRecording,
            failed: harness.events.failed.length,
        }),
    );
});

async function waitFor(predicate) {
    for (let i = 0; i < 500; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for recorder state');
}
