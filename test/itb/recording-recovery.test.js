'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const { MirakurunRecordingStub, sendAndHold } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');
const RecordingManageModel = require('../../dist/model/operator/recording/RecordingManageModel').default;

const waitFor = async predicate => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for recorder state');
};

test('startup resumes the same recording after truncating an interrupted TS packet', async t => {
    const firstStub = new MirakurunRecordingStub([sendAndHold(40)]);
    const first = new RecorderHarness(firstStub);
    await first.start();
    const reserve = createReserve(99401, Date.now() + 10_000);
    first.recorder.setTimer(reserve, true);
    await waitFor(() => first.events.start.length === 1);

    await waitFor(async () => {
        try {
            return (await fs.stat(first.recorder.videoFileFullPath)).size >= 40 * 188;
        } catch {
            return false;
        }
    });
    const beforeCrashSize = (await fs.stat(first.recorder.videoFileFullPath)).size;
    await fs.appendFile(first.recorder.videoFileFullPath, Buffer.alloc(73, 0xa5));
    const beforeRecoverySize = (await fs.stat(first.recorder.videoFileFullPath)).size;
    const recordedRow = first.recorded[0];
    const session = first.recorder.recordingSession;
    const attempts = first.recordingAttempts;
    const videoFile = first.videoFiles[0];
    reserve.isTimeSpecified = true;

    const secondStub = new MirakurunRecordingStub([sendAndHold(30)]);
    const second = new RecorderHarness(secondStub);
    await second.start();
    t.after(async () => {
        second.recorder.isFinishing = true;
        second.recorder.upstreamSession?.stop('teardown');
        await second.recorder.recordingSink?.finish().catch(() => {});
        first.recorder.isFinishing = true;
        first.recorder.upstreamSession?.stop('teardown');
        await first.recorder.recordingSink?.finish().catch(() => {});
        await secondStub.stop();
        await firstStub.stop();
        await fs.rm(first.tempDir, { recursive: true, force: true });
        await fs.rm(second.tempDir, { recursive: true, force: true });
    });

    const config = second.recorder.config;
    config.recorded = [{ name: first.tempDir, path: first.tempDir }];
    second.recorder.configuration = first.recorder.configuration;
    second.recorder.recordedDB = first.recorder.recordedDB;
    second.recorder.recordingSessionDB = first.recorder.recordingSessionDB;
    second.recorder.videoFileDB = first.recorder.videoFileDB;
    second.recorder.reserveDB = { findId: async id => (id === reserve.id ? reserve : null) };
    second.recorder.recordingEvent = first.recorder.recordingEvent;
    second.recorder.recordedHistoryDB = first.recorder.recordedHistoryDB;
    second.recorder.recordingUtil = first.recorder.recordingUtil;
    second.recorder.channelDB = first.recorder.channelDB;
    second.recorder.programDB = first.recorder.programDB;
    second.recorder.dropLogFileDB = first.recorder.dropLogFileDB;
    second.recorder.dropChecker = first.recorder.dropChecker;
    second.recorder.notification = first.recorder.notification;
    second.recorder.reserveEvent = first.recorder.reserveEvent;
    second.recorder.eitPresentStore = first.recorder.eitPresentStore;

    const manager = Object.create(RecordingManageModel.prototype);
    manager.log = first.recorder.log;
    manager.config = config;
    manager.provider = async () => second.recorder;
    manager.recordingSessionDB = first.recorder.recordingSessionDB;
    manager.recordedDB = {
        findId: id => first.recorder.recordedDB.findId(id),
        findAll: async () => [[recordedRow], 1],
        removeRecording: id => first.recorder.recordedDB.removeRecording(id),
        updateOnce: row => first.recorder.recordedDB.updateOnce(row),
    };
    manager.reserveDB = { findId: async id => (id === reserve.id ? reserve : null) };
    manager.recordingUtil = first.recorder.recordingUtil;
    manager.recordingEvent = first.recorder.recordingEvent;
    manager.recordingIndex = {};

    await manager.cleanup();
    const afterRecoverySize = (await fs.stat(first.recorder.videoFileFullPath)).size;
    assert.equal(afterRecoverySize, Math.floor(beforeRecoverySize / 188) * 188);
    assert.equal(beforeRecoverySize - afterRecoverySize, beforeRecoverySize % 188);
    assert.equal(first.videoFiles.length, 1);
    assert.equal(recordedRow.id, session.recordedId);

    await manager.update({ update: [{ ...reserve }] });
    assert.equal(manager.recordingIndex[reserve.id], second.recorder, 'EPG update must reuse the resumed recorder');
    assert.equal(session.state, 'RECORDING');
    assert.equal(manager.hasReserve(reserve.id), true);

    await waitFor(() => attempts.length === 2 && attempts[1].firstDataAt !== null);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].fileOffsetEnd, beforeRecoverySize);
    assert.equal(attempts[1].fileOffsetStart, afterRecoverySize);
    assert.ok(attempts[1].firstDataAt - attempts[0].endedAt >= 0);
    t.diagnostic(
        `crash file bytes ${beforeRecoverySize} -> ${afterRecoverySize}; attempts ${attempts.length}; ` +
            `gap ${attempts[1].firstDataAt - attempts[0].endedAt} ms; recordedId ${recordedRow.id} preserved`,
    );
    assert.equal(first.videoFiles.length, 1);
    assert.equal(recordedRow.id, session.recordedId);

    second.recordingStreamCreator.closeStream(second.recorder.stream, 'scheduled-end');
    await waitFor(() => first.events.finish.length === 1);
    const finalSize = (await fs.stat(first.recorder.videoFileFullPath)).size;
    assert.equal(finalSize % 188, 0);
    assert.equal(recordedRow.recordingStatus, 'partial');
    assert.equal(recordedRow.id, session.recordedId);
});

test('expired manual recovery finalizes partial and leaves the reservation untouched', async () => {
    const manager = Object.create(RecordingManageModel.prototype);
    const now = Date.now();
    const reserve = { id: 99402, ruleId: null, startAt: now - 5000, endAt: now - 1000 };
    const recorded = {
        id: 12,
        reserveId: reserve.id,
        isRecording: true,
        videoFiles: [],
        recordingStatus: null,
        endReason: null,
    };
    const session = { id: 34, recordedId: recorded.id, state: 'RECORDING', reserveId: reserve.id };
    const finishEvents = [];
    let resumeAttempts = 0;
    manager.log = { system: { info() {}, warn() {}, error() {}, fatal() {} } };
    manager.config = { recorded: [], recording: {}, timeSpecifiedStartMargin: 0, timeSpecifiedEndMargin: 0 };
    manager.recordingSessionDB = {
        deleteOrphanSessionsBefore: async () => 0,
        findByState: async state => (state === 'RECORDING' ? [session] : []),
        updateSession: async (id, values) => Object.assign(session, values),
        findAttemptsBySessionId: async () => [],
    };
    manager.recordedDB = {
        findId: async () => recorded,
        findAll: async () => [[recorded], 1],
        removeRecording: async () => {
            recorded.isRecording = false;
        },
        updateOnce: async row => Object.assign(recorded, row),
    };
    manager.reserveDB = { findId: async id => (id === reserve.id ? reserve : null) };
    manager.provider = async () => ({
        setResumeTimer() {
            resumeAttempts++;
            return true;
        },
    });
    manager.recordingUtil = { updateVideoFileSize: async () => {} };
    manager.recordingEvent = { emitFinishRecording: (...args) => finishEvents.push(args) };

    await manager.cleanup();
    assert.equal(resumeAttempts, 0);
    assert.equal(session.resultStatus, 'partial');
    assert.equal(session.endReason, 'process-restart');
    assert.equal(recorded.recordingStatus, 'partial');
    assert.equal(finishEvents.length, 1);
    assert.equal(finishEvents[0][2], false);
    assert.equal(reserve.id, 99402);
});

function createReserve(id, endAt) {
    const now = Date.now();
    return {
        id,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'test',
        startAt: now,
        endAt,
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
