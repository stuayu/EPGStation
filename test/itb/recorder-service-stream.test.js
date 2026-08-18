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

const makeRecorder = (recording, streamCreator = { getCloseReason: () => null }) =>
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
    if (recorder.eventRelayTimerId !== null) {
        clearTimeout(recorder.eventRelayTimerId);
        recorder.eventRelayTimerId = null;
    }
};

class SynchronousFirstDataStream extends PassThrough {
    pipe(destination, options) {
        // Readable#pipe() による resume と同時に最初の data が届くケースを再現する。
        this.emit('data', Buffer.from('live-first-chunk'));
        return super.pipe(destination, options);
    }
}

const buildEitPacket = (serviceId, eventId) => {
    const event = Buffer.alloc(16);
    event.writeUInt16BE(eventId, 0);
    event.fill(0xff, 2, 7);
    event[7] = 0x00;
    event[8] = 0x30;
    event[9] = 0x00;
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

test('service stream の開始確定時は source を pause し、待機バッファ後から live TS を再開できる', async () => {
    const recorder = makeRecorder({ startGateTimeoutMs: 0, programStreamMode: 'service' });
    const source = new PassThrough();
    recorder.reserve = { ...reserve };
    recorder.stream = source;

    const waiting = recorder.waitForProgramStart();
    source.write(Buffer.from('before'));
    const buffered = await waiting;
    assert.equal(source.isPaused(), true);
    source.write(Buffer.from('after'));

    const received = [];
    source.on('data', chunk => received.push(chunk));
    source.resume();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(Buffer.concat(buffered).toString(), 'before');
    assert.equal(Buffer.concat(received).toString(), 'after');
    source.destroy();
});

test('録画開始 listener は pipe より先に登録され、同期的な first data を取り逃さない', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'epgstation-recorder-pipe-race-'));
    const recPath = path.join(tempDir, 'race.ts');
    const recorder = makeRecorder({
        firstDataTimeoutMs: 25,
        programStreamMode: 'service',
    });
    const source = new SynchronousFirstDataStream();
    let started = 0;
    recorder.reserve = { ...reserve };
    recorder.stream = source;
    recorder.waitForProgramStart = async () => [Buffer.from('waiting-buffer')];
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
        assert.equal((await fs.promises.readFile(recPath)).toString(), 'waiting-buffer');
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

test('予定終了による premature close は録画失敗ではなく正常終了へ送る', async () => {
    const source = new PassThrough();
    const recorder = makeRecorder({}, { getCloseReason: stream => (stream === source ? 'scheduled-end' : null) });
    recorder.reserve = { ...reserve, endAt: Date.now() + 60_000 };
    recorder.recordedId = 10;
    let ended = 0;
    let failed = 0;
    recorder.recEnd = async () => {
        ended++;
    };
    recorder.recFailed = async () => {
        failed++;
    };

    await recorder.setEndProcess(source);
    source.destroy();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ended, 1);
    assert.equal(failed, 0);
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

test('録画準備中の endAt 変更は録画開始まで待ってからハードタイマーへ反映する', async () => {
    const calls = [];
    const recorder = makeRecorder(
        { programStreamMode: 'service' },
        {
            getCloseReason: () => null,
            changeEndAt: r => {
                // 準備中に呼ばれた場合は stream 未登録として失敗する creator を再現する
                if (recorder.isRecording !== true) throw new Error('StreamChangeAtError');
                calls.push(r.endAt);
            },
        },
    );
    const current = nearReserve();
    recorder.reserve = current;
    recorder.isPrepRecording = true;
    recorder.isRecording = false;

    const newReserve = { ...current, endAt: current.endAt + 600_000 };
    const updated = recorder.update(newReserve, true);

    // 録画開始前は反映されない
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(calls, []);

    // 録画開始で待ちが解け、新しい endAt が渡る
    recorder.isPrepRecording = false;
    recorder.isRecording = true;
    recorder.eventEmitter.emit(RecorderModel.START_RECORDING_EVENT);

    await updated;
    assert.deepEqual(calls, [newReserve.endAt]);
    assert.equal(recorder.reserve.endAt, newReserve.endAt);
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
