'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const aribts = require('aribts');
const EitPresentParser = require('../../dist/model/operator/recording/EitPresentParser').default;

const makeSection = ({ tableId = 0x4e, serviceId = 21504, transportStreamId = 100, originalNetworkId = 200, sectionNumber = 7, events }) => {
    const body = Buffer.alloc(11 + events.length * 12);
    body.writeUInt16BE(serviceId, 0);
    body[2] = 0xf1; // version 0, current_next_indicator=1
    body[3] = sectionNumber;
    body[4] = 0;
    body.writeUInt16BE(transportStreamId, 5);
    body.writeUInt16BE(originalNetworkId, 7);
    body[9] = 0;
    body[10] = tableId;
    events.forEach((event, index) => {
        const offset = 11 + index * 12;
        body.writeUInt16BE(event.eventId, offset);
        body.fill(0xff, offset + 2, offset + 7); // undefined start_time
        body[offset + 7] = event.duration[0];
        body[offset + 8] = event.duration[1];
        body[offset + 9] = event.duration[2];
        body[offset + 10] = event.runningStatus << 5;
        body[offset + 11] = 0;
    });
    const sectionLength = body.length + 4;
    const section = Buffer.alloc(3 + sectionLength);
    section[0] = tableId;
    section[1] = 0xf0 | ((sectionLength >> 8) & 0x0f);
    section[2] = sectionLength & 0xff;
    body.copy(section, 3);
    aribts.TsCrc32.calcToBuffer(section.subarray(0, section.length - 4)).copy(section, section.length - 4);
    return section;
};

const makePacket = section => {
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40;
    packet[2] = 0x12;
    packet[3] = 0x10;
    packet[4] = 0;
    section.copy(packet, 5);
    return packet;
};

// NVOD 参照サービスだけは 1 section に複数 event が載る。その場合は section 内の順序で present/following とする
test('1 section に複数 event がある場合は先頭を present、次を following として読む', () => {
    const parser = new EitPresentParser();
    const events = parser.write(
        makePacket(
            makeSection({
                sectionNumber: 0,
                events: [
                    { eventId: 1, duration: [0x01, 0x02, 0x03], runningStatus: 4 },
                    { eventId: 2, duration: [0xff, 0xff, 0xff], runningStatus: 2 },
                ],
            }),
        ),
    );
    assert.deepEqual(
        events.map(event => [event.eventId, event.isFollowing, event.durationSec, event.runningStatus]),
        [
            [1, false, 3723, 4],
            [2, true, null, 2],
        ],
    );
});

// EIT[p/f] は present = section_number 0 / following = section_number 1 だけを使う
// (0/1 以外は p/f のサブテーブルではないので捨てる)
test('section 番号が 0/1 以外の section は捨てる', () => {
    const section = makeSection({
        sectionNumber: 3,
        events: [{ eventId: 9, duration: [0, 0x30, 0], runningStatus: 4 }],
    });
    assert.deepEqual(new EitPresentParser().write(makePacket(section)), []);
});

// 実放送では 1 section に 1 event で、present / following は section_number で分かれる
// (実測: ＮＨＫ総合１・福島 の section_number 0 = present, last_section_number = 1)
test('present と following は section_number で判別する', () => {
    const parser = new EitPresentParser();
    const present = makeSection({
        sectionNumber: 0,
        events: [{ eventId: 5742, duration: [0, 0x25, 0], runningStatus: 0 }],
    });
    const following = makeSection({
        sectionNumber: 1,
        events: [{ eventId: 39925, duration: [0, 0x05, 0], runningStatus: 0 }],
    });

    const p1 = parser.write(makePacket(present));
    assert.equal(p1[0].eventId, 5742);
    assert.equal(p1[0].isFollowing, false);

    const p2 = parser.write(makePacket(following));
    assert.equal(p2[0].eventId, 39925);
    assert.equal(p2[0].isFollowing, true, 'section_number 1 は following として扱う');
});

test('table_id、CRC、BCD、識別子が不正な section を捨てる', () => {
    const base = { events: [{ eventId: 9, duration: [0, 0x30, 0], runningStatus: 4 }] };
    assert.deepEqual(new EitPresentParser().write(makePacket(makeSection({ ...base, tableId: 0x4f }))), []);

    const syntaxBad = makeSection(base);
    syntaxBad[1] &= 0x7f;
    aribts.TsCrc32.calcToBuffer(syntaxBad.subarray(0, -4)).copy(syntaxBad, syntaxBad.length - 4);
    assert.deepEqual(new EitPresentParser().write(makePacket(syntaxBad)), []);

    const crcBad = makeSection(base);
    crcBad[crcBad.length - 1] ^= 1;
    assert.deepEqual(new EitPresentParser().write(makePacket(crcBad)), []);

    assert.deepEqual(
        new EitPresentParser().write(
            makePacket(makeSection({ events: [{ eventId: 9, duration: [0x00, 0x6a, 0x00], runningStatus: 4 }] })),
        ),
        [],
    );
    assert.deepEqual(
        new EitPresentParser({ serviceId: 21505, transportStreamId: 100, originalNetworkId: 200 }).write(
            makePacket(makeSection(base)),
        ),
        [],
    );
});
