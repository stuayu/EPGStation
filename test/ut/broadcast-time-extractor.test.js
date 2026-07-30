'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const BroadcastTimeExtractor = require('../../dist/model/service/stream/util/BroadcastTimeExtractor').default;

const PID_TDT = 0x14;

/**
 * MJD + BCD の日時バイト列を作る
 */
function jstTimeBuffer(year, month, day, hour, minute, second) {
    let y = year - 1900;
    let m = month;
    const k = m === 1 || m === 2 ? 1 : 0;
    if (k === 1) {
        y -= 1;
        m += 12;
    }
    const mjd = Math.floor(365.25 * y) + Math.floor(30.6001 * (m + 1)) + day + 14956;
    const bcd = value => ((Math.floor(value / 10) << 4) | value % 10) & 0xff;

    const buffer = Buffer.alloc(5);
    buffer.writeUInt16BE(mjd, 0);
    buffer[2] = bcd(hour);
    buffer[3] = bcd(minute);
    buffer[4] = bcd(second);

    return buffer;
}

/**
 * TDT / TOT のセクションを 1 つの TS パケットに詰める
 */
function buildTimePacket(tableId, jstTime, counter = 0) {
    // table_id(1) + section header(2) + JST_time(5)
    const section = Buffer.concat([Buffer.from([tableId, 0x70, 0x05]), jstTime]);

    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40 | ((PID_TDT >> 8) & 0x1f); // payload_unit_start_indicator = 1
    packet[2] = PID_TDT & 0xff;
    packet[3] = 0x10 | (counter & 0x0f); // payload only
    packet[4] = 0x00; // pointer_field
    section.copy(packet, 5);

    return packet;
}

/**
 * TDT / TOT 以外のパケット (映像など)
 */
function buildOtherPacket(pid) {
    const packet = Buffer.alloc(188, 0x00);
    packet[0] = 0x47;
    packet[1] = (pid >> 8) & 0x1f;
    packet[2] = pid & 0xff;
    packet[3] = 0x10;

    return packet;
}

function write(extractor, packets) {
    const passed = [];
    extractor.on('data', chunk => passed.push(chunk));
    for (const packet of packets) {
        extractor.write(packet);
    }

    return Buffer.concat(passed);
}

test('TDT から放送時刻を読み取る', () => {
    const extractor = new BroadcastTimeExtractor();
    write(extractor, [buildOtherPacket(0x0100), buildTimePacket(0x70, jstTimeBuffer(2026, 7, 31, 22, 30, 15))]);

    const result = extractor.getBroadcastTime();

    assert.notEqual(result, null);
    // TS 上の時刻は JST 固定なので、サーバのタイムゾーンに関係なく同じ UNIX 時刻になる
    assert.equal(result.time, Date.UTC(2026, 6, 31, 22, 30, 15) - 9 * 3600 * 1000);
    assert.ok(result.receivedAt > 0);
});

test('TOT からも放送時刻を読み取る', () => {
    const extractor = new BroadcastTimeExtractor();
    write(extractor, [buildTimePacket(0x73, jstTimeBuffer(2026, 1, 1, 0, 0, 0))]);

    const result = extractor.getBroadcastTime();

    assert.notEqual(result, null);
    assert.equal(result.time, Date.UTC(2026, 0, 1, 0, 0, 0) - 9 * 3600 * 1000);
});

test('新しい TDT を受け取ると値を更新する', () => {
    const extractor = new BroadcastTimeExtractor();
    write(extractor, [
        buildTimePacket(0x70, jstTimeBuffer(2026, 7, 31, 22, 30, 15), 0),
        buildTimePacket(0x70, jstTimeBuffer(2026, 7, 31, 22, 30, 20), 1),
    ]);

    assert.equal(extractor.getBroadcastTime().time, Date.UTC(2026, 6, 31, 22, 30, 20) - 9 * 3600 * 1000);
});

test('入力された TS はそのまま下流へ流す', () => {
    const extractor = new BroadcastTimeExtractor();
    const packets = [buildOtherPacket(0x0100), buildTimePacket(0x70, jstTimeBuffer(2026, 7, 31, 22, 30, 15))];

    const passed = write(extractor, packets);

    assert.deepEqual(passed, Buffer.concat(packets));
});

test('TDT / TOT が無ければ null のまま', () => {
    const extractor = new BroadcastTimeExtractor();
    write(extractor, [buildOtherPacket(0x0100), buildOtherPacket(0x0101)]);

    assert.equal(extractor.getBroadcastTime(), null);
});

test('未定義時刻 (全ビット 1) は採用しない', () => {
    const extractor = new BroadcastTimeExtractor();
    write(extractor, [buildTimePacket(0x70, Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]))]);

    assert.equal(extractor.getBroadcastTime(), null);
});

test('壊れた時刻 (BCD として不正) は採用しない', () => {
    const extractor = new BroadcastTimeExtractor();
    // 時が 99 時になるバイト列
    const broken = jstTimeBuffer(2026, 7, 31, 0, 0, 0);
    broken[2] = 0x99;
    write(extractor, [buildTimePacket(0x70, broken)]);

    assert.equal(extractor.getBroadcastTime(), null);
});
