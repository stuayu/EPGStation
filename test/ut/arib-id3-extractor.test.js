'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const AribId3Extractor = require('../../dist/model/service/stream/llhls/AribId3Extractor').default;
const { parsePes } = require('../../dist/model/service/stream/llhls/AribId3Extractor');

// in-memory HLS で ARIB 字幕を配信するために、エンコード前の TS から
// arib-subtitle-timedmetadater が載せた ID3 timed metadata を抜き取る Transform のテスト。
// 実際の TS を持ち込まずに済むよう、PAT / PMT / PES を最小構成で組み立てて流し込む。

const PACKET_SIZE = 188;

/**
 * TS パケットを 1 つ作る (adaptation field 無し・payload のみ)
 */
function makePacket(pid, payloadUnitStart, payload) {
    const packet = Buffer.alloc(PACKET_SIZE, 0xff);
    packet[0] = 0x47;
    packet[1] = (payloadUnitStart === true ? 0x40 : 0x00) | ((pid >> 8) & 0x1f);
    packet[2] = pid & 0xff;
    packet[3] = 0x10; // adaptation_field_control = 01 (payload only)
    payload.copy(packet, 4, 0, Math.min(payload.length, PACKET_SIZE - 4));

    return packet;
}

/**
 * PSI セクションを payload 形式にする (先頭に pointer_field を足す)
 */
function toSectionPayload(section) {
    return Buffer.concat([Buffer.from([0x00]), section]);
}

/**
 * PMT PID を 1 つ持つ PAT
 */
function makePat(pmtPid) {
    // table_id(1) + section_length(2) + [tsid(2) version(1) section(1) last(1)] + program(4) + CRC(4)
    const section = Buffer.alloc(16, 0x00);
    section[0] = 0x00; // table_id: PAT
    const sectionLength = section.length - 3;
    section[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
    section[2] = sectionLength & 0xff;
    // program_number = 1 (0 は network PID なので読み飛ばされる)
    section[8] = 0x00;
    section[9] = 0x01;
    section[10] = 0xe0 | ((pmtPid >> 8) & 0x1f);
    section[11] = pmtPid & 0xff;

    return section;
}

/**
 * stream_type を 1 つ持つ PMT
 */
function makePmt(streamType, elementaryPid) {
    // header(12) + stream(5) + CRC(4)
    const section = Buffer.alloc(21, 0x00);
    section[0] = 0x02; // table_id: PMT
    const sectionLength = section.length - 3;
    section[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
    section[2] = sectionLength & 0xff;
    section[10] = 0xf0; // program_info_length = 0
    section[11] = 0x00;
    section[12] = streamType;
    section[13] = 0xe0 | ((elementaryPid >> 8) & 0x1f);
    section[14] = elementaryPid & 0xff;
    section[15] = 0xf0; // ES_info_length = 0
    section[16] = 0x00;

    return section;
}

/**
 * PSI セクションを複数の TS パケットに分割する
 * (arib-subtitle-timedmetadater は PMT に記述子と ES を書き足すため、実放送では分割されうる)
 */
function packetizeSection(pid, section) {
    const payload = toSectionPayload(section);
    const packets = [];
    let offset = 0;
    while (offset < payload.length) {
        const chunk = payload.subarray(offset, offset + (PACKET_SIZE - 4));
        packets.push(makePacket(pid, offset === 0, chunk));
        offset += PACKET_SIZE - 4;
    }

    return packets;
}

/**
 * ES を大量に持つ PMT (1 TS パケットに収まらない大きさになる)
 */
function makeLargePmt(streamType, elementaryPid, dummyStreamCount) {
    // header(12) + dummy streams(5 each) + target stream(5) + CRC(4)
    const section = Buffer.alloc(12 + 5 * dummyStreamCount + 5 + 4, 0x00);
    section[0] = 0x02;
    const sectionLength = section.length - 3;
    section[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
    section[2] = sectionLength & 0xff;
    section[10] = 0xf0;
    section[11] = 0x00;

    let offset = 12;
    for (let i = 0; i < dummyStreamCount; i++) {
        section[offset] = 0x02; // MPEG-2 video
        section[offset + 1] = 0xe0 | (((0x200 + i) >> 8) & 0x1f);
        section[offset + 2] = (0x200 + i) & 0xff;
        section[offset + 3] = 0xf0;
        section[offset + 4] = 0x00;
        offset += 5;
    }

    // 末尾に metadata ES を置く (分割された 2 パケット目に載る)
    section[offset] = streamType;
    section[offset + 1] = 0xe0 | ((elementaryPid >> 8) & 0x1f);
    section[offset + 2] = elementaryPid & 0xff;
    section[offset + 3] = 0xf0;
    section[offset + 4] = 0x00;

    return section;
}

/**
 * ID3v2 タグを作る (ヘッダ 10 byte + 本体)
 */
function makeId3Tag(body) {
    const header = Buffer.alloc(10, 0x00);
    header.write('ID3', 0, 'ascii');
    header[3] = 0x04; // version 2.4
    // syncsafe integer
    header[6] = (body.length >> 21) & 0x7f;
    header[7] = (body.length >> 14) & 0x7f;
    header[8] = (body.length >> 7) & 0x7f;
    header[9] = body.length & 0x7f;

    return Buffer.concat([header, body]);
}

/**
 * PTS 付きの private_stream_1 PES を作る
 * @param options.padding ffmpeg 向けの 5 byte パディングを挿入するか
 * @param options.streamId stream_id を差し替える (異常系の確認用)
 * @param options.ptsDtsFlags PTS フラグを差し替える (異常系の確認用)
 */
function makePes(pts, tag, options = {}) {
    const header = Buffer.alloc(14, 0x00);
    header[0] = 0x00;
    header[1] = 0x00;
    header[2] = 0x01;
    header[3] = options.streamId ?? 0xbd; // private_stream_1
    header[6] = 0x80;
    header[7] = ((options.ptsDtsFlags ?? 0x02) << 6) & 0xff;
    header[8] = 0x05; // PES_header_data_length
    // 33 bit PTS
    header[9] = 0x20 | (((pts / 0x40000000) & 0x07) << 1) | 0x01;
    header[10] = (pts / 0x400000) & 0xff;
    header[11] = ((((pts / 0x8000) & 0x7f) << 1) | 0x01) & 0xff;
    header[12] = (pts / 0x80) & 0xff;
    header[13] = (((pts & 0x7f) << 1) | 0x01) & 0xff;

    const body =
        options.padding === true ? Buffer.concat([Buffer.alloc(5, 0x00), tag]) : tag;
    const packetLength = 3 + 5 + body.length;
    header[4] = (packetLength >> 8) & 0xff;
    header[5] = packetLength & 0xff;

    return Buffer.concat([header, body]);
}

/**
 * Extractor に TS を流し、取り出された ID3 と下流へ流れたデータを返す
 */
async function run(packets, logger = null) {
    const extractor = new AribId3Extractor(logger);
    const detected = [];
    const passedThrough = [];
    extractor.on('id3', metadata => detected.push(metadata));
    extractor.on('data', chunk => passedThrough.push(chunk));

    for (const packet of packets) {
        extractor.write(packet);
    }
    await new Promise(resolve => extractor.end(resolve));

    return { detected, passedThrough: Buffer.concat(passedThrough) };
}

const METADATA_PID = 0x0100;
const PMT_PID = 0x1000;
// PMT の stream_type 0x15 が ID3 timed metadata
const STREAM_TYPE_METADATA = 0x15;

test('PAT / PMT をたどって ID3 timed metadata の PES から PTS とタグを取り出す', async () => {
    const tag = makeId3Tag(Buffer.from('subtitle-payload'));
    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        makePacket(PMT_PID, true, toSectionPayload(makePmt(STREAM_TYPE_METADATA, METADATA_PID))),
        makePacket(METADATA_PID, true, makePes(90000, tag)),
    ];

    const { detected } = await run(packets);

    assert.equal(detected.length, 1);
    assert.equal(detected[0].pts, 90000);
    assert.deepEqual(detected[0].payload, tag);
});

test('入力の TS は加工せずそのまま下流へ流す', async () => {
    const tag = makeId3Tag(Buffer.from('x'));
    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        makePacket(PMT_PID, true, toSectionPayload(makePmt(STREAM_TYPE_METADATA, METADATA_PID))),
        makePacket(METADATA_PID, true, makePes(0, tag)),
    ];

    const { passedThrough } = await run(packets);

    assert.deepEqual(passedThrough, Buffer.concat(packets));
});

test('複数 TS パケットにまたがる PES を組み立てる', async () => {
    // 1 パケットの payload (184 byte) に収まらない大きさにする
    const tag = makeId3Tag(Buffer.alloc(300, 0x41));
    const pes = makePes(45000, tag);
    const first = pes.subarray(0, 184);
    const second = pes.subarray(184);

    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        makePacket(PMT_PID, true, toSectionPayload(makePmt(STREAM_TYPE_METADATA, METADATA_PID))),
        makePacket(METADATA_PID, true, first),
        makePacket(METADATA_PID, false, second),
    ];

    const { detected } = await run(packets);

    // 末尾の PES は end (flush) で確定する
    assert.equal(detected.length, 1);
    assert.equal(detected[0].pts, 45000);
    assert.deepEqual(detected[0].payload, tag);
});

test('次の PES が始まると前の PES を確定させる', async () => {
    const first = makeId3Tag(Buffer.from('first'));
    const second = makeId3Tag(Buffer.from('second'));
    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        makePacket(PMT_PID, true, toSectionPayload(makePmt(STREAM_TYPE_METADATA, METADATA_PID))),
        makePacket(METADATA_PID, true, makePes(1000, first)),
        makePacket(METADATA_PID, true, makePes(2000, second)),
    ];

    const { detected } = await run(packets);

    assert.deepEqual(
        detected.map(d => d.pts),
        [1000, 2000],
    );
    assert.deepEqual(detected[0].payload, first);
    assert.deepEqual(detected[1].payload, second);
});

test('arib-subtitle-timedmetadater が挿入する 5 byte のパディングを飛ばす', async () => {
    const tag = makeId3Tag(Buffer.from('padded'));
    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        makePacket(PMT_PID, true, toSectionPayload(makePmt(STREAM_TYPE_METADATA, METADATA_PID))),
        makePacket(METADATA_PID, true, makePes(300, tag, { padding: true })),
    ];

    const { detected } = await run(packets);

    assert.equal(detected.length, 1);
    assert.deepEqual(detected[0].payload, tag);
});

test('PMT に ID3 timed metadata が無ければ何も検出しない', async () => {
    const tag = makeId3Tag(Buffer.from('video'));
    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        // stream_type 0x02 (MPEG-2 video)
        makePacket(PMT_PID, true, toSectionPayload(makePmt(0x02, METADATA_PID))),
        makePacket(METADATA_PID, true, makePes(100, tag)),
    ];

    const { detected, passedThrough } = await run(packets);

    assert.equal(detected.length, 0);
    // 検出できなくても入力はそのまま流す
    assert.deepEqual(passedThrough, Buffer.concat(packets));
});

test('同期バイトから外れたゴミが混ざっても落ちない', async () => {
    const { detected, passedThrough } = await run([Buffer.from('this-is-not-a-ts-stream')]);

    assert.equal(detected.length, 0);
    assert.deepEqual(passedThrough, Buffer.from('this-is-not-a-ts-stream'));
});

test('1 TS パケットに収まらない PMT でも metadata の PID を検出する', async () => {
    // 実際の放送では PMT が 184 byte に収まらず分割される。
    // 先頭パケットしか見ていないと metadata ES を取りこぼし、字幕が 1 つも出なくなる
    const pmt = makeLargePmt(STREAM_TYPE_METADATA, METADATA_PID, 40);
    const pmtPackets = packetizeSection(PMT_PID, pmt);
    assert.ok(pmtPackets.length > 1);

    const tag = makeId3Tag(Buffer.from('split-pmt'));
    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        ...pmtPackets,
        makePacket(METADATA_PID, true, makePes(500, tag)),
    ];

    const { detected } = await run(packets);

    assert.equal(detected.length, 1);
    assert.deepEqual(detected[0].payload, tag);
});

test('PES_packet_length で確定するので次の字幕を待たない', async () => {
    // 字幕の間隔は数秒〜数十秒あるため、次の PES 到着まで待つと実質表示されない
    const tag = makeId3Tag(Buffer.from('immediate'));
    const packets = [
        makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
        makePacket(PMT_PID, true, toSectionPayload(makePmt(STREAM_TYPE_METADATA, METADATA_PID))),
        makePacket(METADATA_PID, true, makePes(600, tag)),
    ];

    const extractor = new AribId3Extractor(null);
    const detected = [];
    extractor.on('id3', metadata => detected.push(metadata));
    extractor.on('data', () => {});
    for (const packet of packets) {
        extractor.write(packet);
    }

    // end() を待たずに (= 次の PES を待たずに) 検出できている
    assert.equal(detected.length, 1);
    assert.equal(detected[0].pts, 600);

    await new Promise(resolve => extractor.end(resolve));
    assert.equal(detected.length, 1);
});

test('PES として成立しない入力は取り出さない', () => {
    const tag = makeId3Tag(Buffer.from('x'));

    // 短すぎる
    assert.equal(parsePes(Buffer.alloc(10)), null);
    // stream_id が private_stream_1 ではない
    assert.equal(parsePes(makePes(0, tag, { streamId: 0xe0 })), null);
    // PTS を持たない
    assert.equal(parsePes(makePes(0, tag, { ptsDtsFlags: 0x00 })), null);
    // ID3 ヘッダが無い
    assert.equal(parsePes(makePes(0, Buffer.alloc(20, 0x00))), null);
});

test('33bit の PTS を取り違えない', () => {
    const tag = makeId3Tag(Buffer.from('x'));
    for (const pts of [0, 1, 90000, 0x1ffffffff]) {
        const parsed = parsePes(makePes(pts, tag));
        assert.equal(parsed.pts, pts);
    }
});

test('PID を検出したときはログを残す', async () => {
    const messages = [];
    const logger = {
        stream: {
            info: message => messages.push(message),
            warn: message => messages.push(message),
            error: () => {},
            debug: () => {},
        },
    };

    await run(
        [
            makePacket(0x0000, true, toSectionPayload(makePat(PMT_PID))),
            makePacket(PMT_PID, true, toSectionPayload(makePmt(STREAM_TYPE_METADATA, METADATA_PID))),
        ],
        logger,
    );

    assert.equal(
        messages.some(message => message.includes(String(METADATA_PID))),
        true,
    );
});
