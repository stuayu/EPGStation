'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    decideRecordingStart,
    resolveRecordingStartGateConfig,
    DEFAULT_RECORDING_START_GATE_CONFIG,
} = require('../../dist/model/operator/recording/RecordingStartGate');
const EitPresentParser = require('../../dist/model/operator/recording/EitPresentParser').default;
const aribts = require('aribts');

const config = DEFAULT_RECORDING_START_GATE_CONFIG;
const RESERVE_START = Date.parse('2026-08-02T21:00:00+09:00');

test('programId 予約は EIT[p/f] present の eventId が一致したら開始する', () => {
    const decision = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 100, startAt: RESERVE_START, durationSec: 1800 },
        elapsedMs: 0,
        config,
    });

    assert.equal(decision.canStart, true);
    assert.equal(decision.reason, 'eventMatched');
});

test('programId 予約で eventId が一致しない場合は予約開始時刻に達しても待つ', () => {
    const decision = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        // 放送側で event_id が振り直された目的の番組
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START, durationSec: 1800 },
        elapsedMs: 0,
        config,
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'previousProgram');
});

test('programId 予約で尺の確定した別番組が続いても開始しない', () => {
    const decision = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        // 予約開始時刻より前に始まった、尺の確定している別番組
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 30 * 60 * 1000, durationSec: 1800 },
        elapsedMs: config.timeoutMs,
        config,
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'previousProgram');
});

test('programId 予約で放送時間未定 (延長中) の前番組が続く間は上限を過ぎても開始しない', () => {
    const decision = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 3600000, durationSec: null },
        elapsedMs: config.timeoutMs * 10,
        config,
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'previousProgramExtending');
});

test('時刻指定予約で尺の確定した前番組が続いても上限を過ぎたら開始する', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 30 * 60 * 1000, durationSec: 1800 },
        elapsedMs: config.timeoutMs,
        config,
    });

    assert.equal(decision.canStart, true);
    assert.equal(decision.reason, 'timeout');
});

test('前番組が放送時間未定 (延長しうる) の間は録画を開始しない', () => {
    const decision = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        // 放送時間未定の前番組 (野球中継など)
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 3600000, durationSec: null },
        elapsedMs: 10 * 60 * 1000,
        config,
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'previousProgramExtending');
});

test('時刻指定予約は放送中の番組の開始時刻が予約開始時刻に達したら開始する', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        // 実送出が 30 秒早い場合もマージン内なら開始する
        present: { serviceId: 1, eventId: 100, startAt: RESERVE_START - 30 * 1000, durationSec: 1800 },
        elapsedMs: 0,
        config,
    });

    assert.equal(decision.canStart, true);
    assert.equal(decision.reason, 'startTimeReached');
});

test('時刻指定予約は EIT を先に検出しても録画開始マージンまでは待つ', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 100, startAt: RESERVE_START - 30 * 1000, durationSec: 1800 },
        elapsedMs: 0,
        currentAt: RESERVE_START - 10 * 1000,
        recordingStartMarginMs: 1000,
        config,
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'waitingForStartMargin');
});

test('時刻指定予約は EIT を読めずタイムアウトしても開始マージンまでは開始しない', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        present: null,
        elapsedMs: 0,
        currentAt: RESERVE_START - 10 * 1000,
        recordingStartMarginMs: 1000,
        config: { ...config, timeoutMs: 0 },
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'waitingForStartMargin');
});

test('時刻指定予約で前番組が続いている間は録画を開始しない', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 3600000, durationSec: 3600 },
        elapsedMs: 0,
        config,
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'previousProgram');
});

test('時刻指定予約は following の開始時刻に達したら present 更新前でも開始する', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 3600000, durationSec: null },
        following: { serviceId: 1, eventId: 100, startAt: RESERVE_START, durationSec: 1800, isFollowing: true },
        elapsedMs: 0,
        currentAt: RESERVE_START,
        recordingStartMarginMs: 1000,
        config,
    });

    assert.equal(decision.canStart, true);
    assert.equal(decision.reason, 'startTimeReached');
});

test('following の開始時刻が繰り下がった場合は実際の開始時刻まで待つ', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 3600000, durationSec: null },
        following: { serviceId: 1, eventId: 100, startAt: RESERVE_START + 5 * 60 * 1000, durationSec: 1800, isFollowing: true },
        elapsedMs: 0,
        currentAt: RESERVE_START,
        recordingStartMarginMs: 1000,
        config,
    });

    assert.equal(decision.canStart, false);
    assert.equal(decision.reason, 'previousProgramExtending');
});

test('following が将来を示していてもゲート上限後は録画を開始する', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: 1_000_000,
        present: { serviceId: 1, eventId: 99, startAt: 900_000, durationSec: 600 },
        following: { serviceId: 1, eventId: 100, startAt: 1_200_000, durationSec: 600, isFollowing: true },
        currentAt: 1_000_000,
        elapsedMs: 60_000,
        recordingStartMarginMs: 1_000,
        config: { ...config, timeoutMs: 60_000, startMarginMs: 0 },
    });

    assert.deepEqual(decision, { canStart: true, reason: 'timeout' });
});

test('放送時間未定の前番組でも開始ゲートの上限後は録画を開始する', () => {
    const decision = decideRecordingStart({
        eventId: null,
        reserveStartAt: RESERVE_START,
        present: {
            serviceId: 21512,
            eventId: 100,
            startAt: RESERVE_START - 3 * 60 * 1000,
            durationSec: null,
        },
        elapsedMs: 60 * 1000,
        currentAt: RESERVE_START + 45 * 1000,
        recordingStartMarginMs: 1000,
        config,
    });

    assert.equal(decision.canStart, true);
    assert.equal(decision.reason, 'timeout');
});

// 録り逃しの方が損害が大きいので、判断がつかないまま上限を過ぎたら開始する
test('EIT[p/f] を読めないまま上限を過ぎたら録画を開始する', () => {
    const waiting = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        present: null,
        elapsedMs: config.timeoutMs - 1,
        config,
    });
    assert.equal(waiting.canStart, false);
    assert.equal(waiting.reason, 'waitingForEit');

    const timeout = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        present: null,
        elapsedMs: config.timeoutMs,
        config,
    });
    assert.equal(timeout.canStart, true);
    assert.equal(timeout.reason, 'timeout');
});

test('ゲートを無効にすると常に開始する', () => {
    const decision = decideRecordingStart({
        eventId: 100,
        reserveStartAt: RESERVE_START,
        present: { serviceId: 1, eventId: 99, startAt: RESERVE_START - 3600000, durationSec: null },
        elapsedMs: 0,
        config: { ...config, enabled: false },
    });

    assert.equal(decision.canStart, true);
    assert.equal(decision.reason, 'disabled');
});

test('設定値は未指定・範囲外なら既定値へ丸める', () => {
    assert.deepEqual(resolveRecordingStartGateConfig(undefined), DEFAULT_RECORDING_START_GATE_CONFIG);
    assert.equal(resolveRecordingStartGateConfig({ startGateEnabled: false }).enabled, false);
    assert.equal(resolveRecordingStartGateConfig({ startGateTimeoutMs: -1 }).timeoutMs, 0);
    assert.equal(
        resolveRecordingStartGateConfig({ startGateStartMarginMs: 'x' }).startMarginMs,
        DEFAULT_RECORDING_START_GATE_CONFIG.startMarginMs,
    );
});

/**
 * EIT[p/f] present のセクションを載せた TS パケットを作る
 */
const buildEitPacket = (serviceId, eventId, startAt, durationSec, sectionNumber = 0) => {
    const body = Buffer.alloc(12 + 4); // event 12 byte + CRC 4 byte
    body.writeUInt16BE(eventId, 0);

    if (startAt === null) {
        body.fill(0xff, 2, 7);
    } else {
        // UNIX 時刻 (ms) → MJD + BCD (JST)
        const jst = startAt + 9 * 60 * 60 * 1000;
        const mjd = Math.floor(jst / 86400000) + 40587;
        const rest = Math.floor((jst % 86400000) / 1000);
        const toBcd = v => ((Math.floor(v / 10) << 4) | v % 10) & 0xff;
        body.writeUInt16BE(mjd, 2);
        body[4] = toBcd(Math.floor(rest / 3600));
        body[5] = toBcd(Math.floor((rest % 3600) / 60));
        body[6] = toBcd(rest % 60);
    }

    if (durationSec === null) {
        body[7] = 0xff;
        body[8] = 0xff;
        body[9] = 0xff;
    } else {
        const toBcd = v => ((Math.floor(v / 10) << 4) | v % 10) & 0xff;
        body[7] = toBcd(Math.floor(durationSec / 3600));
        body[8] = toBcd(Math.floor((durationSec % 3600) / 60));
        body[9] = toBcd(durationSec % 60);
    }
    body[10] = 0x00; // running_status / free_CA_mode / descriptors_loop_length
    body[11] = 0x00;

    const header = Buffer.alloc(14);
    header[0] = 0x4e; // table_id (EIT[p/f] actual)
    const sectionLength = 11 + body.length; // header の残り (14 - 3) + body
    header[1] = 0x80 | ((sectionLength >> 8) & 0x0f);
    header[2] = sectionLength & 0xff;
    header.writeUInt16BE(serviceId, 3);
    header[5] = 0x01; // version / current_next_indicator
    header[6] = sectionNumber;
    header[7] = 0x01; // last_section_number
    header.writeUInt16BE(1, 8); // transport_stream_id
    header.writeUInt16BE(1, 10); // original_network_id
    header[12] = 0x00;
    header[13] = 0x4e;

    const section = Buffer.concat([header, body]);
    aribts.TsCrc32.calcToBuffer(section.subarray(0, -4)).copy(section, section.length - 4);
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40; // payload_unit_start_indicator + pid 上位 (0x0012)
    packet[2] = 0x12;
    packet[3] = 0x10; // payload only
    packet[4] = 0x00; // pointer_field
    section.copy(packet, 5);

    return packet;
};

test('EIT[p/f] present から放送中の番組を取り出せる', () => {
    const parser = new EitPresentParser();
    const events = parser.write(buildEitPacket(1024, 4660, RESERVE_START, 1800));

    assert.equal(events.length, 1);
    assert.equal(events[0].serviceId, 1024);
    assert.equal(events[0].eventId, 4660);
    assert.equal(events[0].startAt, RESERVE_START);
    assert.equal(events[0].durationSec, 1800);
});

test('放送時間未定 (0xFFFFFF) は durationSec が null になる', () => {
    const parser = new EitPresentParser();
    const events = parser.write(buildEitPacket(1024, 4660, RESERVE_START, null));

    assert.equal(events.length, 1);
    assert.equal(events[0].durationSec, null);
});

test('EIT[p/f] following のセクションを解析できる', () => {
    const parser = new EitPresentParser();
    const events = parser.write(buildEitPacket(1024, 4661, RESERVE_START, 1800, 1));

    assert.equal(events.length, 1);
    assert.equal(events[0].isFollowing, true);
    assert.equal(events[0].eventId, 4661);
});

test('current_next_indicator が0のEITは録画開始判定に使わない', () => {
    const packet = buildEitPacket(1024, 4662, RESERVE_START, 1800);
    packet[5 + 5] = 0x00;

    const parser = new EitPresentParser();
    assert.deepEqual(parser.write(packet), []);
});

test('CRCが壊れたEITは録画開始判定に使わない', () => {
    const packet = buildEitPacket(1024, 4663, RESERVE_START, 1800);
    packet[5 + 14] ^= 0x01;

    const parser = new EitPresentParser();
    assert.deepEqual(parser.write(packet), []);
});
