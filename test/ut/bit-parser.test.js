'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const aribts = require('aribts');

const BitParser = require('../../dist/model/channel/BitParser').default;

const BIT_PID = 0x0024;
const TS_PACKET_SIZE = 188;

/**
 * extended_broadcaster_descriptor (tag 0xCE / broadcaster_type = 1) を作る
 */
const createExtendedBroadcasterDescriptor = (terrestrialBroadcasterId, affiliationIds, broadcasters) => {
    const body = [];
    body.push(0x1f); // broadcaster_type = 1, reserved_future_use
    body.push((terrestrialBroadcasterId >> 8) & 0xff, terrestrialBroadcasterId & 0xff);
    body.push(((affiliationIds.length & 0x0f) << 4) | (broadcasters.length & 0x0f));
    for (const id of affiliationIds) {
        body.push(id & 0xff);
    }
    for (const b of broadcasters) {
        body.push((b.originalNetworkId >> 8) & 0xff, b.originalNetworkId & 0xff, b.broadcasterId & 0xff);
    }

    return Buffer.from([0xce, body.length].concat(body));
};

/**
 * BIT セクションを作る (CRC_32 付き)
 */
const createBitSection = (originalNetworkId, broadcasters) => {
    const loop = [];
    for (const b of broadcasters) {
        const descriptors = Buffer.concat(b.descriptors);
        loop.push(
            Buffer.concat([
                Buffer.from([b.broadcasterId, 0xf0 | ((descriptors.length >> 8) & 0x0f), descriptors.length & 0xff]),
                descriptors,
            ]),
        );
    }
    const loopBuffer = Buffer.concat(loop);

    // table_id + section_length を除いた部分 (original_network_id 以降) + CRC_32
    const sectionLength = 5 + 2 + loopBuffer.length + 4;
    const head = Buffer.from([
        0xc4,
        0xf0 | ((sectionLength >> 8) & 0x0f),
        sectionLength & 0xff,
        (originalNetworkId >> 8) & 0xff,
        originalNetworkId & 0xff,
        0xc1, // reserved + version_number = 0 + current_next_indicator = 1
        0x00, // section_number
        0x00, // last_section_number
        0xe0, // reserved_future_use + broadcast_view_propriety + first_descriptors_length 上位
        0x00, // first_descriptors_length 下位 (= 0)
    ]);

    const body = Buffer.concat([head, loopBuffer]);

    return Buffer.concat([body, aribts.TsCrc32.calcToBuffer(body)]);
};

/**
 * セクションを 1 つの TS パケットに詰める (188 byte に収まる長さ限定)
 */
const createTsPacket = (section, pid = BIT_PID) => {
    const packet = Buffer.alloc(TS_PACKET_SIZE, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40 | ((pid >> 8) & 0x1f); // payload_unit_start_indicator = 1
    packet[2] = pid & 0xff;
    packet[3] = 0x10; // payload only
    packet[4] = 0x00; // pointer_field
    section.copy(packet, 5);

    return packet;
};

test('BIT から系列識別と original_network_id を取り出せる', () => {
    const section = createBitSection(0x7fe0, [
        {
            broadcasterId: 0x01,
            descriptors: [
                createExtendedBroadcasterDescriptor(0x0001, [0x02], [{ originalNetworkId: 0x7fe0, broadcasterId: 0x01 }]),
            ],
        },
    ]);

    const parser = new BitParser();
    const result = parser.write(createTsPacket(section));

    assert.equal(result.length, 1);
    assert.equal(result[0].originalNetworkId, 0x7fe0);
    assert.equal(result[0].broadcasters.length, 1);
    assert.deepEqual(result[0].broadcasters[0].affiliationIds, [0x02]);
    assert.deepEqual(result[0].broadcasters[0].networkIds, [0x7fe0]);
    assert.equal(result[0].broadcasters[0].terrestrialBroadcasterId, 0x0001);
});

test('クロスネット局のように系列識別が複数あっても全て取れる', () => {
    const section = createBitSection(0x7fe1, [
        {
            broadcasterId: 0x05,
            descriptors: [
                createExtendedBroadcasterDescriptor(0x0002, [0x03, 0x05], [{ originalNetworkId: 0x7fe1, broadcasterId: 0x05 }]),
            ],
        },
    ]);

    const result = new BitParser().write(createTsPacket(section));
    assert.deepEqual(result[0].broadcasters[0].affiliationIds, [0x03, 0x05]);
});

test('同一セクションに複数の放送事業者が載っていても分けて取れる', () => {
    const section = createBitSection(0x7fe2, [
        {
            broadcasterId: 0x01,
            descriptors: [
                createExtendedBroadcasterDescriptor(0x0001, [0x02], [{ originalNetworkId: 0x7fe2, broadcasterId: 0x01 }]),
            ],
        },
        {
            broadcasterId: 0x02,
            descriptors: [
                createExtendedBroadcasterDescriptor(0x0002, [0x04], [{ originalNetworkId: 0x7fe3, broadcasterId: 0x02 }]),
            ],
        },
    ]);

    const result = new BitParser().write(createTsPacket(section));
    assert.equal(result[0].broadcasters.length, 2);
    assert.deepEqual(result[0].broadcasters[0].networkIds, [0x7fe2]);
    assert.deepEqual(result[0].broadcasters[1].networkIds, [0x7fe3]);
});

test('CRC_32 が壊れているセクションは無視される', () => {
    const section = createBitSection(0x7fe0, [
        {
            broadcasterId: 0x01,
            descriptors: [
                createExtendedBroadcasterDescriptor(0x0001, [0x02], [{ originalNetworkId: 0x7fe0, broadcasterId: 0x01 }]),
            ],
        },
    ]);
    section[section.length - 1] = section[section.length - 1] ^ 0xff;

    assert.equal(new BitParser().write(createTsPacket(section)).length, 0);
});

test('BIT 以外の PID は解析対象にならない', () => {
    const section = createBitSection(0x7fe0, [
        {
            broadcasterId: 0x01,
            descriptors: [
                createExtendedBroadcasterDescriptor(0x0001, [0x02], [{ originalNetworkId: 0x7fe0, broadcasterId: 0x01 }]),
            ],
        },
    ]);

    assert.equal(new BitParser().write(createTsPacket(section, 0x0014)).length, 0);
});

test('チャンクが TS パケット境界で切れていても復元できる', () => {
    const section = createBitSection(0x7fe0, [
        {
            broadcasterId: 0x01,
            descriptors: [
                createExtendedBroadcasterDescriptor(0x0001, [0x02], [{ originalNetworkId: 0x7fe0, broadcasterId: 0x01 }]),
            ],
        },
    ]);
    const packet = createTsPacket(section);

    const parser = new BitParser();
    assert.equal(parser.write(packet.subarray(0, 100)).length, 0);
    const result = parser.write(packet.subarray(100));
    assert.equal(result.length, 1);
    assert.equal(result[0].originalNetworkId, 0x7fe0);
});
