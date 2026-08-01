'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    decideRecordingStart,
    resolveRecordingStartGateConfig,
    DEFAULT_RECORDING_START_GATE_CONFIG,
} = require('../../dist/model/operator/recording/RecordingStartGate');
const EitPresentParser = require('../../dist/model/operator/recording/EitPresentParser').default;

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
const buildEitPacket = (serviceId, eventId, startAt, durationSec) => {
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
    header[5] = 0x00; // version
    header[6] = 0x00; // section_number = 0 (present)
    header[7] = 0x01; // last_section_number
    header.writeUInt16BE(1, 8); // transport_stream_id
    header.writeUInt16BE(1, 10); // original_network_id
    header[12] = 0x00;
    header[13] = 0x4e;

    const section = Buffer.concat([header, body]);
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
