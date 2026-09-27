'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { MirakurunRecordingStub, sendThenReset, sendThenEnd, sendAndHold } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');

const makeReserve = (id, durationMs = 2500) => {
    const now = Date.now();
    return {
        id,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'test',
        startAt: now,
        endAt: now + durationMs,
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
};

const waitFor = async (predicate, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for recorder state');
};

test('A: ECONNRESET 後も同じ Recorded と TS ファイルへ 188 byte 単位で再接続する', async t => {
    const firstPacketCount = 30;
    const secondPacketCount = 20;
    const stub = new MirakurunRecordingStub([
        sendThenReset(firstPacketCount, 73, { conn: 1, delayMs: 20 }),
        sendAndHold(secondPacketCount, { conn: 2 }),
    ]);
    const harness = new RecorderHarness(stub, {
        recording: { reconnectEnabled: true, firstDataTimeoutMs: 1000 },
    });
    await harness.start();
    t.after(() => harness.cleanup());

    const reserve = makeReserve(99101);
    harness.recorder.setTimer(reserve, true);
    await waitFor(() => harness.events.finish.length === 1);

    const requests = stub.requests.filter(request => request.url.includes('/stream'));
    const files = await fs.promises.readdir(harness.tempDir);
    assert.equal(requests.length, 2);
    assert.equal(harness.recorded.length, 1);
    assert.equal(files.length, 1);
    assert.equal(files[0].includes('(1)'), false);

    const file = await fs.promises.readFile(`${harness.tempDir}/${files[0]}`);
    assert.equal(file.length, (firstPacketCount + secondPacketCount) * 188);
    assert.equal(file.length % 188, 0);
    for (let offset = 0; offset < file.length; offset += 188) assert.equal(file[offset], 0x47);
    assert.equal(file.readUInt32BE(firstPacketCount * 188 + 4), 2);
    assert.equal(file.readUInt32BE(firstPacketCount * 188 + 8), 0);

    assert.equal(harness.recordingSessions.length, 1);
    assert.equal(harness.recordingSessions[0].resultStatus, 'partial');
    assert.equal(harness.recordingAttempts.length, 2);
    assert.equal(harness.recordingAttempts[0].errorCode, 'ECONNRESET');
    assert.equal(harness.recordingAttempts[0].fileOffsetStart, 0);
    assert.equal(harness.recordingAttempts[0].fileOffsetEnd, firstPacketCount * 188);
    assert.equal(harness.recordingAttempts[1].fileOffsetStart, firstPacketCount * 188);
    assert.equal(harness.recordingAttempts[1].fileOffsetEnd, file.length);
    assert.equal(harness.recorded[0].transportGapCount, 1);
    assert.ok(harness.recordingAttempts[1].firstDataAt > harness.recordingAttempts[0].endedAt);
    assert.equal(harness.events.failed.length, 0);
    assert.equal(harness.events.finish.length, 1);
    t.diagnostic(
        JSON.stringify({
            requests: requests.length,
            recorded: harness.recorded.length,
            files: [{ name: files[0], size: file.length, mod188: file.length % 188 }],
            gapMs: harness.recordingAttempts[1].firstDataAt - harness.recordingAttempts[0].endedAt,
            attempts: harness.recordingAttempts.length,
            failed: harness.events.failed.length,
            finish: harness.events.finish.length,
        }),
    );
});

test('B: 上流の正常 EOF も予約締切前なら再接続する', async t => {
    const stub = new MirakurunRecordingStub([
        sendThenEnd(3, { conn: 1 }),
        sendAndHold(3, { conn: 2 }),
    ]);
    const harness = new RecorderHarness(stub, { recording: { reconnectEnabled: true } });
    await harness.start();
    t.after(() => harness.cleanup());

    harness.recorder.setTimer(makeReserve(99102, 1400), true);
    await waitFor(() => stub.requests.filter(request => request.url.includes('/stream')).length === 2).catch(err => {
        err.message += ` requests=${JSON.stringify(stub.requests)} start=${harness.events.start.length} failed=${harness.events.failed.length} attempts=${JSON.stringify(harness.recordingAttempts)} sessions=${JSON.stringify(harness.recordingSessions)} finish=${JSON.stringify(harness.events.finish)}`;
        throw err;
    });
    await harness.recorder.cancel(false);
    await waitFor(() => harness.events.finish.length === 1);
    assert.equal(stub.requests.filter(request => request.url.includes('/stream')).length, 2);
    assert.equal(harness.recorded.length, 1);
    assert.equal(harness.recordingAttempts.length, 2);
    assert.equal(harness.events.failed.length, 0);
});

test('C: legacy program stream は正常 EOF で再接続しない', async t => {
    const stub = new MirakurunRecordingStub([sendThenEnd(3, { conn: 1 })]);
    const harness = new RecorderHarness(stub, {
        recording: { reconnectEnabled: true, programStreamMode: 'program' },
    });
    await harness.start();
    t.after(() => harness.cleanup());

    const reserve = makeReserve(99103, 2500);
    reserve.programId = 1234500123;
    harness.recorder.setTimer(reserve, true);
    await waitFor(() => stub.requests.some(request => request.url.includes('/stream')));
    assert.equal(harness.events.start.length, 1);
    await waitFor(() => harness.events.finish.length === 1);
    const requests = stub.requests.filter(request => request.url.includes('/stream'));
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^\/api\/programs\/1234500123\/stream/);
    assert.equal(harness.recordingAttempts.length, 1);
    assert.equal(harness.events.failed.length, 0);
});

test('D: 再接続中のキャンセルは接続を増やさず一度だけ finish する', async t => {
    const stub = new MirakurunRecordingStub([
        sendThenReset(3, 0, { conn: 1, delayMs: 20 }),
        sendAndHold(3, { conn: 2 }),
    ]);
    const harness = new RecorderHarness(stub, { recording: { reconnectEnabled: true } });
    await harness.start();
    t.after(() => harness.cleanup());

    harness.recorder.setTimer(makeReserve(99104, 10_000), true);
    await waitFor(() => stub.requests.filter(request => request.url.includes('/stream')).length === 2);
    await harness.recorder.cancel(false);
    await waitFor(() => harness.events.finish.length === 1);
    assert.equal(stub.requests.filter(request => request.url.includes('/stream')).length, 2);
    assert.equal(harness.events.failed.length, 0);
    assert.equal(harness.events.finish.length, 1);
});

test('E: 再接続が締切まで成功しなくても partial として終了する', async t => {
    const stub = new MirakurunRecordingStub([sendThenReset(3, 0, { conn: 1, delayMs: 20 })]);
    const harness = new RecorderHarness(stub, { recording: { reconnectEnabled: true } });
    await harness.start();
    t.after(() => harness.cleanup());

    harness.recorder.setTimer(makeReserve(99105, 1200), true);
    await waitFor(() => harness.events.finish.length === 1);
    const requests = stub.requests.filter(request => request.url.includes('/stream'));
    assert.ok(requests.length >= 2);
    assert.equal(harness.recorded.length, 1);
    assert.equal(harness.recorded[0].recordingStatus, 'partial');
    assert.equal(harness.events.failed.length, 0);
    assert.equal(harness.events.finish.length, 1);
});

test('F: drop checker は再接続前後を通じて同じ録画 sink の TS を受ける', async t => {
    const stub = new MirakurunRecordingStub([
        sendThenReset(3, 0, { conn: 1, delayMs: 20 }),
        sendAndHold(3, { conn: 2 }),
    ]);
    const harness = new RecorderHarness(stub, {
        recording: { reconnectEnabled: true },
        isEnabledDropCheck: true,
    });
    await harness.start();
    t.after(() => harness.cleanup());

    let observedBytes = 0;
    const updateRows = [];
    harness.recorder.dropChecker = {
        start: async (config, filePath, source) => {
            source.on('data', chunk => { observedBytes += chunk.length; });
        },
        getFilePath: () => '/tmp/recorder-reconnect-drop.log',
        getResult: async () => ({ 256: { error: 0, drop: 2, scrambling: 0 } }),
        stop: async () => {},
    };
    harness.recorder.dropLogFileDB = {
        insertOnce: async () => 1,
        updateCnt: async row => updateRows.push(row),
    };
    harness.recorder.setTimer(makeReserve(99106, 1800), true);
    await waitFor(() => harness.events.finish.length === 1);
    assert.equal(stub.requests.filter(request => request.url.includes('/stream')).length, 2);
    assert.ok(observedBytes >= 6 * 188, `drop checker saw ${observedBytes} bytes`);
    assert.equal(updateRows.length, 1);
    assert.ok(updateRows[0].dropCnt > 0);
    assert.equal(harness.events.failed.length, 0);
});
