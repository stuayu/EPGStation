'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { MirakurunRecordingStub, sendAndHold } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');
const RecordingManageModel = require('../../dist/model/operator/recording/RecordingManageModel').default;
const { createOperatorShutdownHandler } = require('../../dist/util/OperatorShutdown');

const waitFor = async predicate => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for recorder state');
};

test('SIGTERM shutdown waits for sink finish, records process-shutdown, and emits no recording failure', async t => {
    const stub = new MirakurunRecordingStub([sendAndHold(20)]);
    const harness = new RecorderHarness(stub);
    await harness.start();
    t.after(() => harness.cleanup());

    const now = Date.now();
    harness.recorder.setTimer(
        {
            id: 99301,
            programId: null,
            channelId: 12345,
            channelType: 'GR',
            channel: 'test',
            startAt: now,
            endAt: now + 10_000,
            isTimeSpecified: true,
            isConflict: false,
            isFollowingSchedule: false,
            isEventRelay: false,
            allowEndLack: false,
            isSkip: false,
            isOverlap: false,
            name: null,
            halfWidthName: null,
        },
        true,
    );
    await waitFor(() => harness.events.start.length === 1);

    const sink = harness.recorder.recordingSink;
    const originalFinish = sink.finish.bind(sink);
    let finishCompleted = false;
    let closeReasonDuringFinish;
    sink.finish = async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 60));
        closeReasonDuringFinish = harness.recordingAttempts[0].closeReason;
        await originalFinish(...args);
        finishCompleted = true;
    };

    const manager = Object.create(RecordingManageModel.prototype);
    manager.recordingIndex = { 99301: harness.recorder };
    const dispatchedSignals = [];
    const exits = [];
    const errors = [];
    const shutdownHandler = createOperatorShutdownHandler(
        async signal => {
            dispatchedSignals.push(signal);
            await manager.shutdown();
        },
        code => exits.push(code),
        error => errors.push(error),
    );
    await shutdownHandler('SIGTERM');

    assert.deepEqual(dispatchedSignals, ['SIGTERM']);
    assert.deepEqual(exits, [0]);
    assert.deepEqual(errors, []);
    assert.equal(finishCompleted, true);
    assert.equal(closeReasonDuringFinish, null);
    assert.equal(harness.recordingAttempts.length, 1);
    assert.equal(harness.recordingAttempts[0].closeReason, 'process-shutdown');
    assert.equal(harness.recordingAttempts[0].endedAt > 0, true);
    assert.equal(harness.recordingSessions[0].state, 'RECORDING');
    assert.equal(harness.events.failed.length, 0);
    const [fileName] = await fs.promises.readdir(harness.tempDir);
    const file = await fs.promises.readFile(`${harness.tempDir}/${fileName}`);
    assert.equal(file.length % 188, 0);
});
