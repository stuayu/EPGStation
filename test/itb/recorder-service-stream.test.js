'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const aribts = require('aribts');
require('reflect-metadata');
const RecorderModel = require('../../dist/model/operator/recording/RecorderModel').default;

const logger = { system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} } };

const makeRecorder = (
    recording,
    streamCreator = {
        getCloseReason: () => null,
        markClose() {},
        closeStream(stream) {
            stream.destroy();
        },
    },
) =>
    new RecorderModel(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                recording,
                timeSpecifiedStartMargin: 1,
                timeSpecifiedEndMargin: 1,
            }),
        },
        {},
        {},
        { updateFollowingSchedule: async () => {} },
        {},
        {},
        {},
        {},
        streamCreator,
        {},
        {},
        {},
        {},
        {},
        { emitUpdated() {} },
    );

const reserve = {
    id: 1,
    programId: 1234500123,
    channelId: 1234500001,
    startAt: 1_800_000_000_000,
    endAt: 1_800_003_600_000,
    isFollowingSchedule: false,
};

// setTimeout の 32bit 上限を超えないよう、update() のテストは現在時刻基準の予約を使う
const nearReserve = () => ({ ...reserve, startAt: Date.now() + 60_000, endAt: Date.now() + 3_660_000 });

// endAt 変更時に張られるイベントリレー確認タイマーがテスト後に残らないようにする
const clearEventRelayTimer = recorder => {
    recorder.eventRelayTimer.clear();
};

const tsPackets = (count, pid = 0x100) => {
    const data = Buffer.alloc(count * 188, 0xff);
    for (let i = 0; i < count; i++) {
        const packet = data.subarray(i * 188, (i + 1) * 188);
        packet[0] = 0x47;
        packet[1] = (pid >> 8) & 0x1f;
        packet[2] = pid & 0xff;
        packet[3] = 0x10 | (i & 0x0f);
    }
    return data;
};

const buildEitPacket = (serviceId, eventId, durationSec = 1800) => {
    const event = Buffer.alloc(16);
    event.writeUInt16BE(eventId, 0);
    event.fill(0xff, 2, 7);
    event[7] = durationSec === null ? 0xff : (durationSec >> 16) & 0xff;
    event[8] = durationSec === null ? 0xff : (durationSec >> 8) & 0xff;
    event[9] = durationSec === null ? 0xff : durationSec & 0xff;
    const header = Buffer.alloc(14);
    header[0] = 0x4e;
    const sectionLength = 11 + event.length;
    header[1] = 0x80 | ((sectionLength >> 8) & 0x0f);
    header[2] = sectionLength & 0xff;
    header.writeUInt16BE(serviceId, 3);
    header[5] = 0x01;
    header[6] = 0;
    header[7] = 1;
    header.writeUInt16BE(1, 8);
    header.writeUInt16BE(1, 10);
    header[13] = 0x4e;
    const section = Buffer.concat([header, event]);
    aribts.TsCrc32.calcToBuffer(section.subarray(0, -4)).copy(section, section.length - 4);
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40;
    packet[2] = 0x12;
    packet[3] = 0x10;
    packet[4] = 0;
    section.copy(packet, 5);
    return packet;
};

test('service stream は待機バッファと live TS を連結して書き込む', async () => {
    const recorder = makeRecorder({ startGateTimeoutMs: 0, programStreamMode: 'service', reconnectEnabled: false });
    const source = new PassThrough();
    recorder.reserve = { ...reserve };
    recorder.stream = source;

    const waiting = recorder.waitForProgramStart();
    source.write(tsPackets(1));
    const buffered = await waiting;
    assert.equal(source.isPaused(), true);
    source.write(tsPackets(1, 0x101));

    const received = [];
    source.on('data', chunk => received.push(chunk));
    source.resume();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(Buffer.concat(buffered).length, 188);
    assert.equal(Buffer.concat(received).length, 188);
    assert.equal(Buffer.concat(received)[0], 0x47);
    source.destroy();
});

test('時刻指定予約は開始マージン 0 秒を使い startAt 到達時に開始可能になる', () => {
    const recorder = makeRecorder({ startMarginSec: 8, endMarginSec: 8 });
    recorder.reserve = { ...reserve, isTimeSpecified: true, startMarginSec: 0, endMarginSec: 0 };

    const timing = recorder.getTimingConfig();
    assert.equal(timing.startMarginMs, 0);
    assert.equal(timing.endMarginMs, 0);
    assert.equal(recorder.reserve.startAt - timing.startMarginMs, recorder.reserve.startAt);
});

test('録画開始時に待機 TS を書き込み、上流 EOF 後に finish する', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'epgstation-recorder-pipe-race-'));
    const recPath = path.join(tempDir, 'race.ts');
    const recorder = makeRecorder({
        firstDataTimeoutMs: 25,
        programStreamMode: 'service',
        reconnectEnabled: false,
    });
    const source = new PassThrough();
    let started = 0;
    recorder.reserve = { ...reserve };
    recorder.stream = source;
    const waitingPackets = tsPackets(3, 0x102);
    recorder.waitForProgramStart = async () => [waitingPackets];
    recorder.setFollowingSchedule = async () => {};
    recorder.recordingUtil = { getRecPath: async () => ({ fullPath: recPath }) };
    recorder.addRecorded = async () => ({ id: 1 });
    recorder.setEndProcess = async () => {};
    recorder.setEventRelayTimer = () => {};
    recorder.recordingEvent = { emitStartRecording: () => started++ };

    try {
        await recorder.doRecord();
        assert.equal(started, 1);

        const finished = new Promise(resolve => recorder.recFile.once('finish', resolve));
        source.end();
        await finished;
        const recorded = await fs.promises.readFile(recPath);
        assert.equal(recorded.length, 3 * 188);
        assert.equal(recorded[0], 0x47);
        assert.deepEqual(recorded, waitingPackets);
    } finally {
        source.destroy();
        recorder.passThroughStreamForWrite?.destroy();
        recorder.recFile?.destroy();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
});

test('legacy program stream は最初の Mirakurun データで即時開始し EIT を二重待機しない', async () => {
    const recorder = makeRecorder({ startGateTimeoutMs: 60_000, programStreamMode: 'program' });
    const source = new PassThrough();
    recorder.reserve = { ...reserve };
    recorder.stream = source;

    const waiting = recorder.waitForProgramStart();
    source.write(Buffer.from('filtered-program-data'));
    const buffered = await waiting;
    assert.equal(Buffer.concat(buffered).toString(), 'filtered-program-data');
    assert.equal(source.isPaused(), true);
    source.destroy();
});

test('対象 present の一時的な切替は debounce 中の復帰で終了せず、確定した切替だけで終了する', async () => {
    const recorder = makeRecorder({ programStreamMode: 'service' });
    const source = new PassThrough();
    recorder.reserve = { ...reserve };
    recorder.stream = source;
    const originalDebounce = RecorderModel.BOUNDARY_END_DEBOUNCE_MS;
    RecorderModel.BOUNDARY_END_DEBOUNCE_MS = 10;
    try {
        recorder.setupProgramBoundaryMonitor([buildEitPacket(1, 123)]);
        source.write(buildEitPacket(2, 999));
        assert.equal(recorder.boundaryEndTimerId, null);

        source.write(buildEitPacket(1, 124));
        assert.notEqual(recorder.boundaryEndTimerId, null);
        source.write(buildEitPacket(1, 123));
        assert.equal(recorder.boundaryEndTimerId, null);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(source.destroyed, false);

        const closed = new Promise(resolve => source.once('close', resolve));
        source.write(buildEitPacket(1, 124));
        await closed;
        assert.equal(recorder.boundaryEndReason, 'present-event-changed');
    } finally {
        RecorderModel.BOUNDARY_END_DEBOUNCE_MS = originalDebounce;
        source.destroy();
    }
});

test('legacy program stream には EPGStation 側の終了境界 listener を追加しない', () => {
    const recorder = makeRecorder({ programStreamMode: 'program' });
    const source = new PassThrough();
    recorder.reserve = { ...reserve };
    recorder.stream = source;
    recorder.setupProgramBoundaryMonitor([buildEitPacket(1, 123)]);
    assert.equal(source.listenerCount('data'), 0);
    source.destroy();
});

test('未定番組の対象 present が続き計画終了へ近づくと上限内で延長して再計算する', async () => {
    const calls = [];
    const recorder = makeRecorder({ programStreamMode: 'service' });
    const now = Date.now();
    const targetEventId = reserve.programId % 100000;
    const plannedEndAt = now + 30_000;
    recorder.reserve = {
        ...reserve,
        startAt: now - 60_000,
        endAt: now + 3 * 60 * 60 * 1000,
        plannedEndAt,
        isTimeUndefined: true,
    };
    recorder.programDB = { findSchedule: async () => [] };
    recorder.reserveDB = { updatePlannedEndAt: async (...args) => calls.push(['save', ...args]) };
    recorder.reservationManage = { recalculatePlanForReserve: async id => calls.push(['replan', id]) };
    const source = new PassThrough();
    recorder.stream = source;
    recorder.setupProgramBoundaryMonitor([buildEitPacket(1, targetEventId, null)]);

    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 'save');
    assert.equal(calls[0][1], recorder.reserve.id);
    assert.equal(calls[0][2], Math.min(plannedEndAt + 30 * 60 * 1000, recorder.reserve.endAt));
    assert.deepEqual(calls[1], ['replan', recorder.reserve.id]);
    assert.equal(recorder.reserve.endAt, now + 3 * 60 * 60 * 1000, '安全上限 endAt は維持');
    source.destroy();
});

test('録画準備中の endAt 変更 (延長) はブロックせず即 creator へ渡す', async () => {
    const calls = [];
    const recorder = makeRecorder(
        { programStreamMode: 'service' },
        { getCloseReason: () => null, changeEndAt: r => calls.push(r.endAt) },
    );
    const current = nearReserve();
    recorder.reserve = current;
    recorder.isPrepRecording = true;
    recorder.isRecording = false;

    const newReserve = { ...current, endAt: current.endAt + 600_000 };
    // 張り付き 2 分の間ずっと予約更新が止まらないこと (待ちを入れると 2 分かかる)
    const started = Date.now();
    await recorder.update(newReserve, true);
    assert.ok(Date.now() - started < 1000, `update がブロックしていない (${Date.now() - started}ms)`);

    assert.deepEqual(calls, [newReserve.endAt]);
    assert.equal(recorder.reserve.endAt, newReserve.endAt);
    clearEventRelayTimer(recorder);
});

test('録画中の延長でイベントリレー確認タイマーも張り直す', async () => {
    const recorder = makeRecorder(
        { programStreamMode: 'service' },
        { getCloseReason: () => null, changeEndAt: () => {} },
    );
    const current = nearReserve();
    recorder.reserve = current;
    recorder.isPrepRecording = false;
    recorder.isRecording = true;
    recorder.recordedId = null;

    assert.equal(recorder.eventRelayTimer.isPending, false);
    await recorder.update({ ...current, endAt: current.endAt + 600_000 }, true);
    assert.equal(recorder.eventRelayTimer.isPending, true, '延長でリレー確認タイマーが張られる');
    assert.equal(recorder.isEventRelayTimerSet, true);
    clearEventRelayTimer(recorder);
});

test('録画準備中の延長ではイベントリレー確認タイマーを張らない', async () => {
    const recorder = makeRecorder(
        { programStreamMode: 'service' },
        { getCloseReason: () => null, changeEndAt: () => {} },
    );
    const current = nearReserve();
    recorder.reserve = current;
    recorder.isPrepRecording = true;
    recorder.isRecording = false;

    await recorder.update({ ...current, endAt: current.endAt + 600_000 }, true);
    assert.equal(recorder.eventRelayTimer.isPending, false);
    clearEventRelayTimer(recorder);
});

test('resetTimer は一度でもリレー確認を仕掛けていれば張り直す', async () => {
    const recorder = makeRecorder(
        { programStreamMode: 'service' },
        { getCloseReason: () => null, changeEndAt: () => {} },
    );
    recorder.reserve = nearReserve();
    recorder.isRecording = true;

    // まだ仕掛けていない -> 何もしない
    assert.equal(recorder.resetTimer(), true);
    assert.equal(recorder.eventRelayTimer.isPending, false);

    // 仕掛けたあとは発火済みでも張り直す
    recorder.setEventRelayTimer(recorder.reserve);
    recorder.eventRelayTimer.clear();
    assert.equal(recorder.eventRelayTimer.isPending, false);
    assert.equal(recorder.resetTimer(), true);
    assert.equal(recorder.eventRelayTimer.isPending, true, '張り直された');
    clearEventRelayTimer(recorder);
});

test('録画中の endAt 変更は待たずに即ハードタイマーへ反映する', async () => {
    const calls = [];
    const recorder = makeRecorder(
        { programStreamMode: 'service' },
        { getCloseReason: () => null, changeEndAt: r => calls.push(r.endAt) },
    );
    const current = nearReserve();
    recorder.reserve = current;
    recorder.isPrepRecording = false;
    recorder.isRecording = true;
    recorder.recordedId = null;

    const newReserve = { ...current, endAt: current.endAt + 600_000 };
    await recorder.update(newReserve, true);
    assert.deepEqual(calls, [newReserve.endAt]);
    clearEventRelayTimer(recorder);
});

test('復帰後の setTimer は過去 attempt の終了理由と partial 結果を保持する', async () => {
    const recorder = makeRecorder({ programStreamMode: 'service' });
    recorder.config.recordedTmp = os.tmpdir();
    const now = Date.now();
    const recorded = { id: 1, isRecording: true, videoFiles: [], dropLogFileId: null };
    const session = { id: 1, state: 'RECORDING', recordedId: 1 };
    recorder.recordedDB = {
        removeRecording: async () => {
            recorded.isRecording = false;
        },
        findId: async () => recorded,
        updateOnce: async row => Object.assign(recorded, row),
        updateRecordingResult: async (_id, values) => Object.assign(recorded, values),
    };
    recorder.recordingSessionDB = {
        updateSession: async (_id, values) => Object.assign(session, values),
        findAttemptsBySessionId: async () => [],
    };
    recorder.sessionTracker.db = recorder.recordingSessionDB;
    recorder.recordingEvent = { emitFinishRecording() {} };
    const restored = recorder.setResumeTimer({ ...nearReserve(), programId: null }, true, {
        videoFile: { id: 1, parentDirectoryName: 'tmp', filePath: 'resume.ts', size: 188 },
        session,
        recorded,
        attempts: [{ closeReason: 'transport-lost', endedAt: now - 1000, firstDataAt: now - 2000 }],
    });
    recorder.videoFileId = null;

    try {
        assert.equal(restored, true);
        assert.deepEqual(recorder.sessionTracker.closeReasons, ['transport-lost']);
        await recorder.recEnd();
        assert.equal(recorded.endReason, 'transport-lost');
        assert.equal(recorded.recordingStatus, 'partial');
        assert.equal(session.endReason, 'transport-lost');
        assert.equal(session.resultStatus, 'partial');
    } finally {
        recorder.timer.clear();
    }
});

test('finish 終了時に各終了理由を info ログへ出す', async () => {
    for (const reason of ['canceled', 'boundary', 'scheduled-end', 'tuner-handoff']) {
        const recorder = makeRecorder({ programStreamMode: 'service' });
        const messages = [];
        const recorded = { id: 1, isRecording: true, videoFiles: [] };
        recorder.log.system.info = message => messages.push(message);
        recorder.reserve = { ...nearReserve(), isTimeSpecified: true, ruleId: null, isEventRelay: false };
        recorder.recordedId = recorded.id;
        recorder.recordedDB = {
            removeRecording: async () => {
                recorded.isRecording = false;
            },
            findId: async () => recorded,
            updateOnce: async row => Object.assign(recorded, row),
            updateRecordingResult: async (_id, values) => Object.assign(recorded, values),
        };
        recorder.recordingEvent = { emitFinishRecording() {} };
        recorder.boundaryEndReason = reason;
        recorder.sessionTracker.closeReasons = [reason];

        await recorder.recEnd();
        assert.ok(messages.includes(`recording end: reserveId: ${recorder.reserve.id}, reason: ${reason}`));
    }
});

test('legacy program stream は endAt 変更でハードタイマーを触らない', async () => {
    const calls = [];
    const recorder = makeRecorder(
        { programStreamMode: 'program' },
        { getCloseReason: () => null, changeEndAt: r => calls.push(r.endAt) },
    );
    const current = nearReserve();
    recorder.reserve = current;
    recorder.isPrepRecording = false;
    recorder.isRecording = true;
    recorder.recordedId = null;

    await recorder.update({ ...current, endAt: current.endAt + 600_000 }, true);
    assert.deepEqual(calls, []);
    clearEventRelayTimer(recorder);
});
