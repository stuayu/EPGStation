'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');

const AribSubtitleTimedMetadataTransform =
    require('../../dist/model/service/stream/llhls/AribSubtitleTimedMetadataTransform').default;
const AribId3Extractor = require('../../dist/model/service/stream/llhls/AribId3Extractor').default;
const LibraryTransform = require('arib-subtitle-timedmetadater');

const PACKET_SIZE = 188;
const PMT_PID = 0x100;
const VIDEO_PID = 0x101;
const SUBTITLE_PID = 0x114;
const METADATA_PID = 0x1ffe;

function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        for (let bit = 7; bit >= 0; bit -= 1) {
            const inputBit = (byte >> bit) & 1;
            const topBit = (crc >>> 31) & 1;
            crc = (crc << 1) >>> 0;
            if ((topBit ^ inputBit) !== 0) crc = (crc ^ 0x04c11db7) >>> 0;
        }
    }

    return crc >>> 0;
}

function makeSection(tableId, body) {
    const length = body.length + 4;
    const header = Buffer.from([tableId, 0xb0 | ((length >> 8) & 0x0f), length & 0xff]);
    const section = Buffer.concat([header, body, Buffer.alloc(4)]);
    section.writeUInt32BE(crc32(section.subarray(0, section.length - 4)), section.length - 4);

    return section;
}

function packetize(pid, payload, continuityCounter = 0, payloadUnitStartIndicator = true) {
    const packet = Buffer.alloc(PACKET_SIZE, 0xff);
    packet[0] = 0x47;
    packet[1] = (payloadUnitStartIndicator ? 0x40 : 0) | ((pid >> 8) & 0x1f);
    packet[2] = pid & 0xff;
    packet[3] = 0x10 | continuityCounter;
    payload.copy(packet, 4);

    return packet;
}

function makePat() {
    return makeSection(0x00, Buffer.from([0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00]));
}

function makePmt(videoStreamType, subtitleDescriptor, includeSuper = false) {
    const video = Buffer.from([videoStreamType, 0xe1, 0x01, 0xf0, 0x00]);
    const subtitle = Buffer.concat([
        Buffer.from([0x06, 0x81, 0x14, 0xf0, subtitleDescriptor.length]),
        subtitleDescriptor,
    ]);
    const body = Buffer.concat([
        Buffer.from([0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x01, 0xf0, 0x00]),
        video,
        subtitle,
        ...(includeSuper === true
            ? [Buffer.from([0x06, 0x81, 0x15, 0xf0, 0x03, 0x52, 0x01, 0x38])]
            : []),
    ]);

    return makeSection(0x02, body);
}

function encodePts(pts) {
    return Buffer.from([
        0x21 | ((Math.floor(pts / 0x40000000) & 0x07) << 1),
        Math.floor(pts / 0x400000) & 0xff,
        ((Math.floor(pts / 0x8000) & 0x7f) << 1) | 1,
        Math.floor(pts / 0x80) & 0xff,
        ((pts & 0x7f) << 1) | 1,
    ]);
}

function makeSubtitlePes(pts = 90000, dataGroupId = 0x01, hasPts = true) {
    const data = Buffer.from([0x00, 0x00, 0x00, (dataGroupId << 2) & 0xfc, 0x02, 0x03]);
    const payload = hasPts
        ? Buffer.concat([Buffer.from([0x80, 0x80, 0x05]), encodePts(pts), data])
        : Buffer.concat([Buffer.from([0x80, 0x00, 0x00]), data]);
    const pes = Buffer.concat([Buffer.from([0x00, 0x00, 0x01, 0xbd, 0x00, payload.length]), payload]);

    return packetize(SUBTITLE_PID, pes);
}

function makeInput(videoStreamType, subtitleDescriptor, includeSuper = false, subtitlePes = [makeSubtitlePes()]) {
    return Buffer.concat([
        packetize(0x0000, Buffer.concat([Buffer.from([0x00]), makePat()])),
        packetize(PMT_PID, Buffer.concat([Buffer.from([0x00]), makePmt(videoStreamType, subtitleDescriptor, includeSuper)])),
        ...subtitlePes,
    ]);
}

async function runTransform(TransformClass, input) {
    const transform = new TransformClass();
    const chunks = [];
    transform.on('data', chunk => chunks.push(chunk));
    const ended = once(transform, 'end');
    transform.write(input.subarray(0, 211));
    transform.write(input.subarray(211));
    transform.end();
    await ended;

    return Buffer.concat(chunks);
}

function countPidPackets(data, pid) {
    let count = 0;
    for (let offset = 0; offset + PACKET_SIZE <= data.length; offset += PACKET_SIZE) {
        const packet = data.subarray(offset, offset + PACKET_SIZE);
        if ((((packet[1] & 0x1f) << 8) | packet[2]) === pid) count += 1;
    }

    return count;
}

test('HEVC TS の subtitling_descriptor を ID3 timed metadata へ変換する', async () => {
    const input = makeInput(0x24, Buffer.from([0x59, 0x08, 0x6a, 0x70, 0x6e, 0x10, 0x00, 0x01, 0x00, 0x01]));
    const output = await runTransform(AribSubtitleTimedMetadataTransform, input);

    assert.equal(countPidPackets(output, METADATA_PID), 1);

    const extractor = new AribId3Extractor();
    const metadata = [];
    extractor.on('id3', value => metadata.push(value));
    extractor.on('data', () => {});
    const ended = once(extractor, 'end');
    extractor.end(output);
    await ended;
    assert.equal(metadata.length, 1);
    assert.equal(metadata[0].pts, 90000);
});

test('字幕の後ろに文字スーパーがあっても字幕 PID を選び続ける', async () => {
    const input = makeInput(0x24, Buffer.from([0x52, 0x01, 0x30]), true);
    const output = await runTransform(AribSubtitleTimedMetadataTransform, input);

    assert.equal(countPidPackets(output, METADATA_PID), 1);
});

test('字幕管理データと字幕本文データの data_group_id を ID3 化する', async () => {
    const input = makeInput(
        0x24,
        Buffer.from([0x59, 0x08, 0x6a, 0x70, 0x6e, 0x10, 0x00, 0x01, 0x00, 0x01]),
        false,
        [
            makeSubtitlePes(90000, 0x20),
            makeSubtitlePes(90000, 0x21),
            makeSubtitlePes(90000, 0x28),
            makeSubtitlePes(90000, 0x09),
            makeSubtitlePes(90000, 0x29),
        ],
    );
    const output = await runTransform(AribSubtitleTimedMetadataTransform, input);

    assert.equal(countPidPackets(output, METADATA_PID), 3);
});

test('字幕 PES に PTS が無い場合は時刻を推測せず破棄する', async () => {
    const input = makeInput(
        0x24,
        Buffer.from([0x59, 0x08, 0x6a, 0x70, 0x6e, 0x10, 0x00, 0x01, 0x00, 0x01]),
        false,
        [makeSubtitlePes(90000, 0x21, false)],
    );
    const output = await runTransform(AribSubtitleTimedMetadataTransform, input);

    assert.equal(countPidPackets(output, METADATA_PID), 0);
});

test('HEVC TS では既存ライブラリが字幕 ES を判定できず ID3 を出力しない', async () => {
    const input = makeInput(0x24, Buffer.from([0x59, 0x08, 0x6a, 0x70, 0x6e, 0x10, 0x00, 0x01, 0x00, 0x01]));
    const Library = LibraryTransform.default ?? LibraryTransform;
    const output = await runTransform(Library, input);

    assert.equal(countPidPackets(output, METADATA_PID), 0);
});

test('MPEG-2 TS の従来 component_tag も ID3 timed metadata へ変換する', async () => {
    const descriptor = Buffer.from([0x52, 0x01, 0x30]);
    const input = makeInput(0x02, descriptor);
    const output = await runTransform(AribSubtitleTimedMetadataTransform, input);
    const Library = LibraryTransform.default ?? LibraryTransform;
    const libraryOutput = await runTransform(Library, input);

    assert.equal(countPidPackets(output, METADATA_PID), 1);
    assert.equal(countPidPackets(libraryOutput, METADATA_PID), 1);
});

test('H.264 TS の従来 component_tag も ID3 timed metadata へ変換する', async () => {
    const input = makeInput(0x1b, Buffer.from([0x52, 0x01, 0x30]));
    const output = await runTransform(AribSubtitleTimedMetadataTransform, input);

    assert.equal(countPidPackets(output, METADATA_PID), 1);
});
