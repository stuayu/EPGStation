'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const path = require('node:path');
const { MirakurunRecordingStub, sendThenHold, status } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');

test('normal recording persists one completed session and one attempt', async t => {
    const stub = new MirakurunRecordingStub([sendThenHold(8, { delayMs: 300 })]);
    const harness = new RecorderHarness(stub);
    await harness.start();
    t.after(() => harness.cleanup());
    captureAddError(harness);
    const reserve = createReserve(99201, 8000);
    harness.recorder.setTimer(reserve, true);
    await waitFor(() => harness.events.start.length === 1).catch(err => {
        t.diagnostic(
            JSON.stringify({
                requests: stub.requests,
                sessions: harness.recordingSessions,
                attempts: harness.recordingAttempts,
                failed: harness.events.failed.length,
                addError: harness.addError,
            }),
        );
        throw err;
    });
    harness.recordingStreamCreator.closeStream(harness.recorder.stream, 'scheduled-end');
    await waitFor(() => harness.events.finish.length === 1);
    assert.equal(harness.recordingSessions.length, 1);
    assert.equal(harness.recordingSessions[0].resultStatus, 'completed');
    assert.equal(harness.recordingSessions[0].state, 'FINISHED');
    assert.equal(harness.recordingAttempts.length, 1);
    assert.ok(harness.recordingAttempts[0].firstDataAt > 0);
    assert.ok(harness.recordingAttempts[0].bytesReceived >= 8 * 188);
    assert.equal(harness.recorded[0].recordingStatus, 'completed');
});

test('two start failures remain attempts in the successful session', async t => {
    const stub = new MirakurunRecordingStub([status(503), status(503), sendThenHold(8, { delayMs: 300 })]);
    const harness = new RecorderHarness(stub, { recording: { errorFastRetryIntervalMs: 10, firstDataTimeoutMs: 100 } });
    await harness.start();
    t.after(() => harness.cleanup());
    captureAddError(harness);
    harness.recorder.setTimer(createReserve(99202, 8000), true);
    await waitFor(() => harness.events.start.length === 1).catch(err => {
        t.diagnostic(
            JSON.stringify({
                requests: stub.requests,
                sessions: harness.recordingSessions,
                attempts: harness.recordingAttempts,
                failed: harness.events.failed.length,
                addError: harness.addError,
            }),
        );
        throw err;
    });
    harness.recordingStreamCreator.closeStream(harness.recorder.stream, 'scheduled-end');
    await waitFor(() => harness.events.finish.length === 1);
    assert.equal(stub.requests.filter(request => request.url.includes('/stream')).length, 3);
    assert.equal(harness.recordingSessions.length, 1);
    assert.equal(harness.recordingSessions[0].retryCount, 2);
    assert.equal(harness.recordingSessions[0].resultStatus, 'completed');
    assert.deepEqual(
        harness.recordingAttempts.map(attempt => attempt.attemptNo),
        [1, 2, 3],
    );
    assert.ok(harness.recordingAttempts[0].errorCode);
    assert.ok(harness.recordingAttempts[1].errorCode);
});

test('startup recovery marks an active session partial and keeps its manual reservation', async () => {
    const RecordingManageModel = require('../../dist/model/operator/recording/RecordingManageModel').default;
    const manager = Object.create(RecordingManageModel.prototype);
    const now = Date.now();
    const recorded = {
        id: 11,
        reserveId: 22,
        isRecording: true,
        videoFiles: undefined,
        recordingStatus: null,
        endReason: null,
    };
    const session = { id: 33, recordedId: 11, state: 'RECORDING', reserveId: 22 };
    const updated = [];
    const finishEvents = [];
    manager.log = { system: { info() {}, warn() {}, error() {}, fatal() {} } };
    manager.config = {};
    manager.recordingSessionDB = {
        deleteOrphanSessionsBefore: async () => 0,
        findByState: async () => [session],
        updateSession: async (id, values) => {
            Object.assign(session, values);
            updated.push(values);
        },
    };
    manager.recordedDB = {
        findAll: async () => [[recorded], 1],
        findId: async () => recorded,
        removeRecording: async () => {
            recorded.isRecording = false;
        },
        updateOnce: async value => {
            Object.assign(recorded, value);
        },
    };
    manager.reserveDB = { findId: async () => ({ id: 22, ruleId: null }) };
    manager.recordingUtil = { updateVideoFileSize: async () => {} };
    manager.recordingEvent = { emitFinishRecording: (...args) => finishEvents.push(args) };
    await manager.cleanup();
    assert.equal(session.resultStatus, 'partial');
    assert.equal(session.endReason, 'process-restart');
    assert.equal(recorded.recordingStatus, 'partial');
    assert.equal(recorded.endReason, 'process-restart');
    assert.equal(finishEvents.length, 1);
    assert.equal(finishEvents[0][2], false);
});

test('finish command receives recording result and transport gap environment variables', async t => {
    const ExternalCommandManageModel =
        require('../../dist/model/operator/externalCommand/ExternalCommandManageModel').default;
    const fs = require('node:fs/promises');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-env-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const output = path.join(tempDir, 'env.json');
    const commandModel = Object.create(ExternalCommandManageModel.prototype);
    commandModel.log = { system: { info() {}, error() {} } };
    commandModel.channelDB = { findId: async () => null };
    commandModel.videoUtil = { getFullFilePathFromId: async () => null };
    commandModel.config = { dropLog: tempDir };
    const script = `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({ status: process.env.RECORDING_STATUS, reason: process.env.END_REASON, gaps: process.env.TRANSPORT_GAP_CNT }))`;
    const recorded = {
        id: 71,
        programId: null,
        channelId: 123,
        startAt: 1000,
        endAt: 2000,
        name: 'partial test',
        halfWidthName: 'partial test',
        description: '',
        halfWidthDescription: '',
        extended: '',
        halfWidthExtended: '',
        recordingStatus: 'partial',
        endReason: 'transport-lost',
        videoFiles: undefined,
        dropLogFile: null,
        transportGapCount: 2,
    };
    await commandModel.createRecordedCmd(`${JSON.stringify(process.execPath)} -e '${script}'`, recorded);
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), {
        status: 'partial',
        reason: 'transport-lost',
        gaps: '2',
    });
});

function createReserve(id, durationMs) {
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
}

function captureAddError(harness) {
    const addRecorded = harness.recorder.addRecorded.bind(harness.recorder);
    harness.recorder.addRecorded = async (...args) => {
        try {
            return await addRecorded(...args);
        } catch (err) {
            harness.addError = String(err?.stack ?? err);
            throw err;
        }
    };
}

async function waitFor(predicate) {
    for (let i = 0; i < 1000; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for recorder state');
}
