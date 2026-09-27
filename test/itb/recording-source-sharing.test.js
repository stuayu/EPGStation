'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const { MirakurunRecordingStub, sendThenReset, sendAndHold } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');

const makeReserve = id => {
    const startAt = Date.now();
    return {
        id,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'test',
        startAt,
        endAt: startAt + 2500,
        isTimeSpecified: true,
        isConflict: false,
        isFollowingSchedule: false,
        isEventRelay: false,
        allowEndLack: false,
        isSkip: false,
        isOverlap: false,
        name: `reserve-${id}`,
        halfWidthName: `reserve-${id}`,
    };
};

const waitFor = async (predicate, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for shared recording streams');
};

test('有効時は A/B が1接続を共有し、上流切断後に両方が partial で再接続する', async t => {
    const stub = new MirakurunRecordingStub([
        sendThenReset(20, 73, { conn: 1, delayMs: 100 }),
        sendAndHold(10, { conn: 2 }),
    ]);
    const harness = new RecorderHarness(stub, {
        recording: { shareUpstreamStream: true, reconnectEnabled: true, firstDataTimeoutMs: 1000 },
    });
    await harness.start();
    t.after(() => harness.cleanup());

    const recorderB = harness.createRecorder();
    harness.recorder.setTimer(makeReserve(99201), true);
    recorderB.setTimer(makeReserve(99202), true);
    await waitFor(() => harness.events.finish.length === 2);

    const streamRequests = stub.requests.filter(request => request.url.includes('/stream'));
    assert.equal(streamRequests.length, 2, '初回と再接続で Mirakurun 要求は各1本');
    assert.equal(harness.recorded.length, 2);
    assert.deepEqual(harness.recordingSessions.map(session => session.resultStatus).sort(), ['partial', 'partial']);

    const files = (await fs.readdir(harness.tempDir)).filter(file => file.endsWith('.ts')).sort();
    assert.equal(files.length, 2);
    const sizes = [];
    for (const fileName of files) {
        const data = await fs.readFile(`${harness.tempDir}/${fileName}`);
        sizes.push(data.length);
        assert.ok(data.length > 0);
        assert.equal(data.length % 188, 0);
        for (let offset = 0; offset < data.length; offset += 188) assert.equal(data[offset], 0x47);
        assert.ok(data.includes(Buffer.from([0, 0, 0, 2])), '両ファイルに再接続後の packet がある');
    }
    const gaps = harness.recordingSessions.map(session => {
        const attempts = harness.recordingAttempts.filter(attempt => attempt.sessionId === session.id);
        assert.equal(attempts.length, 2);
        assert.equal(attempts[0].errorCode, 'ECONNRESET');
        return attempts[1].firstDataAt - attempts[0].endedAt;
    });
    assert.ok(gaps.every(gap => gap >= 0));
    t.diagnostic(
        JSON.stringify({ requests: streamRequests.length, sizes, mod188: sizes.map(size => size % 188), gapMs: gaps }),
    );
});

test('未指定 (既定 false) は同じチャンネルでも予約ごとに接続する', async t => {
    const stub = new MirakurunRecordingStub([sendAndHold(5), sendAndHold(5)]);
    const harness = new RecorderHarness(stub);
    await harness.start();
    harness.recorder.cancel = async () => {};
    t.after(() => harness.cleanup());
    const reserves = [makeReserve(99211), makeReserve(99212)];
    const streams = await Promise.all(
        reserves.map(reserve => harness.recordingStreamCreator.create(reserve, new AbortController().signal)),
    );
    await waitFor(() => stub.requests.filter(request => request.url.includes('/stream')).length === 2);
    assert.equal(stub.requests.filter(request => request.url.includes('/stream')).length, 2);
    streams.forEach(stream => harness.recordingStreamCreator.closeStream(stream, 'scheduled-end'));
});
