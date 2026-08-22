'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TsCrc32 } = require('aribts');
const TsInfoAnalyzer = require('../../dist/model/recorded/ts/TsInfoAnalyzer').default;

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }),
};

const PID_PAT = 0x0000;
const PID_NIT = 0x0010;
const PID_SDT = 0x0011;
const PID_EIT = 0x0012;
const PID_TDT = 0x0014;
const PID_PMT = 0x1000;

/**
 * ARIB 8 単位符号で英数字 (全角に変換される) を表すバイト列を作る
 */
function aribText(text) {
    return Buffer.concat([Buffer.from([0x1b, 0x28, 0x4a]), Buffer.from(text, 'ascii')]);
}

/**
 * セクションヘッダ + 本体 + CRC32 を組み立てる
 * TDT のように CRC を持たないテーブルは withCrc = false にする
 */
function buildSection(tableId, body, withCrc = true) {
    const sectionLength = body.length + (withCrc === true ? 4 : 0);
    const header = Buffer.from([tableId, 0xb0 | ((sectionLength >> 8) & 0x0f), sectionLength & 0xff]);
    const withoutCrc = Buffer.concat([header, body]);
    if (withCrc === false) {
        return withoutCrc;
    }

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(TsCrc32.calc(withoutCrc) >>> 0, 0);

    return Buffer.concat([withoutCrc, crc]);
}

/**
 * セクションを 188 byte の TS パケット 1 つに詰める (テストで使うセクションはすべて 183 byte 以下)
 */
function toPacket(pid, section, counter) {
    assert.ok(section.length <= 183, 'test section must fit in a single packet');
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40 | ((pid >> 8) & 0x1f); // payload_unit_start_indicator = 1
    packet[2] = pid & 0xff;
    packet[3] = 0x10 | (counter & 0x0f); // payload only
    packet[4] = 0x00; // pointer_field
    section.copy(packet, 5);

    return packet;
}

/**
 * PAT (1 サービス)
 */
function buildPat(transportStreamId, serviceId, pmtPid) {
    const body = Buffer.alloc(9);
    body.writeUInt16BE(transportStreamId, 0);
    body[2] = 0xc1; // version 0 / current
    body[3] = 0x00; // section_number
    body[4] = 0x00; // last_section_number
    body.writeUInt16BE(serviceId, 5);
    body.writeUInt16BE(0xe000 | pmtPid, 7);

    return buildSection(0x00, body);
}

/**
 * PAT (複数サービス)
 * @param services: { serviceId, pmtPid }[]
 */
function buildPatMulti(transportStreamId, services) {
    const header = Buffer.alloc(5);
    header.writeUInt16BE(transportStreamId, 0);
    header[2] = 0xc1;
    header[3] = 0x00;
    header[4] = 0x00;

    const programs = services.map(s => {
        const program = Buffer.alloc(4);
        program.writeUInt16BE(s.serviceId, 0);
        program.writeUInt16BE(0xe000 | s.pmtPid, 2);

        return program;
    });

    return buildSection(0x00, Buffer.concat([header, ...programs]));
}

/**
 * SDT (複数サービス)
 * @param services: { serviceId, serviceType, providerName, serviceName }[]
 */
function buildSdtMulti(transportStreamId, originalNetworkId, services) {
    const header = Buffer.alloc(8);
    header.writeUInt16BE(transportStreamId, 0);
    header[2] = 0xc1;
    header[3] = 0x00;
    header[4] = 0x00;
    header.writeUInt16BE(originalNetworkId, 5);
    header[7] = 0xff;

    const entries = services.map(s => {
        const provider = aribText(s.providerName);
        const name = aribText(s.serviceName);
        const descriptorBody = Buffer.concat([
            Buffer.from([s.serviceType, provider.length]),
            provider,
            Buffer.from([name.length]),
            name,
        ]);
        const descriptor = Buffer.concat([Buffer.from([0x48, descriptorBody.length]), descriptorBody]);

        const service = Buffer.alloc(5);
        service.writeUInt16BE(s.serviceId, 0);
        service[2] = 0xfc;
        service.writeUInt16BE(0x8000 | descriptor.length, 3);

        return Buffer.concat([service, descriptor]);
    });

    return buildSection(0x42, Buffer.concat([header, ...entries]));
}

/**
 * PMT (映像 1 本 + 音声 1 本)
 */
function buildPmt(serviceId, videoPid, audioPid) {
    const header = Buffer.alloc(9);
    header.writeUInt16BE(serviceId, 0);
    header[2] = 0xc1;
    header[3] = 0x00;
    header[4] = 0x00;
    header.writeUInt16BE(0xe000 | videoPid, 5); // PCR_PID
    header.writeUInt16BE(0xf000, 7); // program_info_length = 0

    const video = Buffer.alloc(5);
    video[0] = 0x02; // MPEG-2 Video
    video.writeUInt16BE(0xe000 | videoPid, 1);
    video.writeUInt16BE(0xf000, 3);

    const audio = Buffer.alloc(5);
    audio[0] = 0x0f; // MPEG-2 AAC
    audio.writeUInt16BE(0xe000 | audioPid, 1);
    audio.writeUInt16BE(0xf000, 3);

    return buildSection(0x02, Buffer.concat([header, video, audio]));
}

/**
 * SDT (service_descriptor 付き 1 サービス)
 */
function buildSdt(transportStreamId, originalNetworkId, serviceId, providerName, serviceName) {
    const provider = aribText(providerName);
    const name = aribText(serviceName);
    const descriptorBody = Buffer.concat([
        Buffer.from([0x01, provider.length]), // service_type = デジタルTVサービス
        provider,
        Buffer.from([name.length]),
        name,
    ]);
    const descriptor = Buffer.concat([Buffer.from([0x48, descriptorBody.length]), descriptorBody]);

    const service = Buffer.alloc(5);
    service.writeUInt16BE(serviceId, 0);
    service[2] = 0xfc; // reserved + EIT flags
    service.writeUInt16BE(0x8000 | descriptor.length, 3); // running_status = 4 (実行中)

    const header = Buffer.alloc(8);
    header.writeUInt16BE(transportStreamId, 0);
    header[2] = 0xc1;
    header[3] = 0x00;
    header[4] = 0x00;
    header.writeUInt16BE(originalNetworkId, 5);
    header[7] = 0xff; // reserved_future_use

    return buildSection(0x42, Buffer.concat([header, service, descriptor]));
}

/**
 * EIT[p/f] present
 */
function buildEit(option) {
    const eventName = aribText(option.eventName);
    const eventText = aribText(option.eventText);
    const shortEventBody = Buffer.concat([
        Buffer.from([0x6a, 0x70, 0x6e, eventName.length]), // jpn
        eventName,
        Buffer.from([eventText.length]),
        eventText,
    ]);
    const shortEvent = Buffer.concat([Buffer.from([0x4d, shortEventBody.length]), shortEventBody]);
    const content = Buffer.from([0x54, 0x02, (option.genre1 << 4) | option.subGenre1, 0xff]);
    const descriptors = Buffer.concat([shortEvent, content]);

    const event = Buffer.alloc(12);
    event.writeUInt16BE(option.eventId, 0);
    option.startTime.copy(event, 2);
    option.duration.copy(event, 7);
    event.writeUInt16BE(0x8000 | descriptors.length, 10);

    const header = Buffer.alloc(11);
    header.writeUInt16BE(option.serviceId, 0);
    header[2] = 0xc1;
    header[3] = 0x00; // section_number = 0 (present)
    header[4] = 0x00;
    header.writeUInt16BE(option.transportStreamId, 5);
    header.writeUInt16BE(option.originalNetworkId, 7);
    header[9] = 0x00; // segment_last_section_number
    header[10] = 0x4e; // last_table_id

    return buildSection(0x4e, Buffer.concat([header, event, descriptors]));
}

/**
 * TDT (CRC を持たない)
 */
function buildTdt(jstTime) {
    return buildSection(0x70, jstTime, false);
}

/**
 * PCR (Program Clock Reference) だけを積んだ adaptation_field-only パケット (ペイロードなし)
 * @param pid: number PMT が示す PCR_PID と一致させること
 * @param pcr27M: number 27MHz 換算の PCR 値 (base * 300 + extension)
 */
function buildPcrPacket(pid, pcr27M) {
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = (pid >> 8) & 0x1f; // payload_unit_start_indicator = 0
    packet[2] = pid & 0xff;
    packet[3] = 0x20; // adaptation_field_control = 10 (adaptation field only, ペイロード無し)
    packet[4] = 7; // adaptation_field_length (flags 1 byte + PCR 6 byte)
    packet[5] = 0x10; // PCR_flag = 1, 他は 0

    const pcrBase = Math.floor(pcr27M / 300);
    const pcrExt = pcr27M % 300;
    // 33bit base + 6bit reserved (すべて 1) + 9bit extension = 48bit (6 byte)
    const combined = pcrBase * Math.pow(2, 15) + (0x3f << 9) + pcrExt;
    packet.writeUIntBE(combined, 6, 6);

    return packet;
}

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

function bcdDuration(hour, minute, second) {
    const bcd = value => ((Math.floor(value / 10) << 4) | value % 10) & 0xff;

    return Buffer.from([bcd(hour), bcd(minute), bcd(second)]);
}

/**
 * テスト用の TS ファイルを書き出してパスを返す
 */
function writeTsFile(name, packets) {
    const filePath = path.join(os.tmpdir(), `epgstation-ts-info-${process.pid}-${name}.ts`);
    fs.writeFileSync(filePath, Buffer.concat(packets));

    return filePath;
}

/**
 * ヌルパケット (PID 0x1FFF)。TS パケット境界の探索が働くよう、詰め物も正しい形にしておく
 */
function buildNullPacket() {
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x1f;
    packet[2] = 0xff;
    packet[3] = 0x10;

    return packet;
}

const createdFiles = [];

/**
 * ヌルパケットで埋めた大きな TS を作り、指定パケット位置にブロックを差し込む
 * @param blocks: { index: number, packets: Buffer[] }[]
 */
function createLargeTsFile(name, totalPackets, blocks) {
    const nullPacket = buildNullPacket();
    const buffer = Buffer.alloc(totalPackets * 188);
    for (let i = 0; i < totalPackets; i++) {
        nullPacket.copy(buffer, i * 188);
    }
    for (const block of blocks) {
        block.packets.forEach((packet, i) => {
            packet.copy(buffer, (block.index + i) * 188);
        });
    }

    const filePath = path.join(os.tmpdir(), `epgstation-ts-info-${process.pid}-${name}.ts`);
    fs.writeFileSync(filePath, buffer);
    createdFiles.push(filePath);

    return filePath;
}

function createTsFile(name, packets) {
    const filePath = writeTsFile(name, packets);
    createdFiles.push(filePath);

    return filePath;
}

test.after(() => {
    for (const filePath of createdFiles) {
        try {
            fs.unlinkSync(filePath);
        } catch (err) {
            // 後始末なので失敗は無視する
        }
    }
});

/**
 * PSI/SI が一通りそろった TS を組み立てる
 */
function buildFullTs(option) {
    const opt = Object.assign(
        {
            transportStreamId: 0x7e87,
            originalNetworkId: 0x7e87,
            serviceId: 1024,
            eitServiceId: 1024,
            videoPid: 0x0100,
            audioPid: 0x0110,
            eventId: 12345,
            eventName: 'TEST PROGRAM',
            eventText: 'TEST TEXT',
            genre1: 0x7,
            subGenre1: 0x0,
            startTime: jstTimeBuffer(2026, 7, 31, 22, 0, 0),
            duration: bcdDuration(0, 30, 0),
            tdtTime: jstTimeBuffer(2026, 7, 31, 21, 59, 55),
        },
        option,
    );

    const packets = [];
    // 同じテーブルが 1 度しか流れないと取りこぼしうるので、実際の放送と同じく繰り返し送る
    for (let i = 0; i < 4; i++) {
        packets.push(toPacket(PID_PAT, buildPat(opt.transportStreamId, opt.serviceId, PID_PMT), i));
        packets.push(toPacket(PID_PMT, buildPmt(opt.serviceId, opt.videoPid, opt.audioPid), i));
        packets.push(
            toPacket(
                PID_SDT,
                buildSdt(opt.transportStreamId, opt.originalNetworkId, opt.serviceId, 'NHK', 'TEST TV'),
                i,
            ),
        );
        packets.push(
            toPacket(
                PID_EIT,
                buildEit({
                    serviceId: opt.eitServiceId,
                    transportStreamId: opt.transportStreamId,
                    originalNetworkId: opt.originalNetworkId,
                    eventId: opt.eventId,
                    eventName: opt.eventName,
                    eventText: opt.eventText,
                    genre1: opt.genre1,
                    subGenre1: opt.subGenre1,
                    startTime: opt.startTime,
                    duration: opt.duration,
                }),
                i,
            ),
        );
        packets.push(toPacket(PID_TDT, buildTdt(opt.tdtTime), i));
    }

    return packets;
}

function createAnalyzer() {
    return new TsInfoAnalyzer(logger);
}

test('PSI/SI から放送局・番組・ストリーム構成を取り出す', async () => {
    const filePath = createTsFile('full', buildFullTs());
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 10000 });

    assert.equal(info.networkId, 0x7e87);
    assert.equal(info.transportStreamId, 0x7e87);
    assert.equal(info.serviceId, 1024);
    assert.equal(info.serviceType, 1);
    assert.equal(info.serviceName, 'ＴＥＳＴ　ＴＶ');
    assert.equal(info.serviceProviderName, 'ＮＨＫ');

    assert.equal(info.eventId, 12345);
    assert.equal(info.eventName, 'ＴＥＳＴ　ＰＲＯＧＲＡＭ');
    assert.equal(info.eventDescription, 'ＴＥＳＴ　ＴＥＸＴ');
    assert.deepEqual(info.genres, [{ lv1: 0x7, lv2: 0x0 }]);

    // TS 上の時刻は JST。サーバのタイムゾーンに関係なく同じ UNIX 時刻になる
    assert.equal(info.eventStartAt, Date.UTC(2026, 6, 31, 22, 0, 0) - 9 * 3600 * 1000);
    assert.equal(info.eventDuration, 1800);
    assert.equal(info.firstTdtAt, Date.UTC(2026, 6, 31, 21, 59, 55) - 9 * 3600 * 1000);

    assert.equal(info.videoStreamType, 0x02);
    assert.equal(info.videoPid, 0x0100);
    assert.equal(info.audioStreamType, 0x0f);
    assert.equal(info.audioPid, 0x0110);
});

test('PAT に無いサービスの EIT は採用しない', async () => {
    // 同じ TS に相乗りしている別サービス (例: NHK 総合 2) の EIT だけが流れている状況
    const filePath = createTsFile('other-service-eit', buildFullTs({ serviceId: 1024, eitServiceId: 1025 }));
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 10000 });

    // PAT / SDT のサービスが採用され、他サービスの番組情報は取り込まれない
    assert.equal(info.serviceId, 1024);
    assert.equal(info.serviceName, 'ＴＥＳＴ　ＴＶ');
    assert.equal(info.eventId, null);
    assert.equal(info.eventName, null);
});

test('放送時間未定 (全ビット 1) の番組は開始時刻と長さを null にする', async () => {
    const filePath = createTsFile(
        'undefined-time',
        buildFullTs({
            startTime: Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]),
            duration: Buffer.from([0xff, 0xff, 0xff]),
        }),
    );
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 10000 });

    assert.equal(info.eventId, 12345);
    assert.equal(info.eventStartAt, null);
    assert.equal(info.eventDuration, null);
});

test('PSI/SI を含まないファイルでも例外を投げずに null を返す', async () => {
    const filePath = createTsFile('no-psi', [Buffer.alloc(188 * 10, 0x00)]);
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 5000 });

    assert.equal(info.serviceId, null);
    assert.equal(info.serviceName, null);
    assert.equal(info.eventId, null);
    assert.equal(info.firstTdtAt, null);
    assert.deepEqual(info.genres, []);
});

test('存在しないファイルでも例外を投げない', async () => {
    const filePath = path.join(os.tmpdir(), `epgstation-ts-info-${process.pid}-not-exists.ts`);
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 5000 });

    assert.equal(info.serviceId, null);
    assert.equal(info.eventId, null);
});

/**
 * PCR による firstTdtAt 補正のテスト用に、PAT/PMT/SDT/EIT + 任意の PCR/TDT パケットを組み立てる
 */
function buildPcrTestPackets(videoPid, audioPid, serviceId, transportStreamId, extraPackets) {
    const psiPackets = [
        toPacket(PID_PAT, buildPat(transportStreamId, serviceId, PID_PMT), 0),
        toPacket(PID_PMT, buildPmt(serviceId, videoPid, audioPid), 0), // PCR_PID = videoPid
        toPacket(PID_SDT, buildSdt(transportStreamId, transportStreamId, serviceId, 'NHK', 'TEST TV'), 0),
        toPacket(
            PID_EIT,
            buildEit({
                serviceId,
                transportStreamId,
                originalNetworkId: transportStreamId,
                eventId: 12345,
                eventName: 'TEST PROGRAM',
                eventText: 'TEST TEXT',
                genre1: 0x7,
                subGenre1: 0x0,
                startTime: jstTimeBuffer(2026, 7, 31, 22, 0, 0),
                duration: bcdDuration(0, 30, 0),
            }),
            0,
        ),
    ];

    return [...psiPackets, ...extraPackets];
}

test('PCR で TDT が見つかった位置までの経過時間を測り、ファイル先頭の時刻へ補正する', async () => {
    const videoPid = 0x0100;
    const audioPid = 0x0110;
    const serviceId = 1024;
    const transportStreamId = 0x7e87;
    const tdtTime = jstTimeBuffer(2026, 7, 31, 22, 0, 0);

    const PCR_START = 2_000_000_000; // 起点 (絶対値自体に意味はない)
    const FIVE_SECONDS_TICKS = 5 * 27_000_000;

    const packets = buildPcrTestPackets(videoPid, audioPid, serviceId, transportStreamId, [
        buildPcrPacket(videoPid, PCR_START), // ファイル先頭付近の PCR
        buildPcrPacket(videoPid, PCR_START + FIVE_SECONDS_TICKS), // 5 秒後、TDT より前の PCR
        toPacket(PID_TDT, buildTdt(tdtTime), 0), // ファイル先頭から 5 秒後の位置で見つかる
    ]);

    // buildPcrTestPackets は PAT/PMT/SDT/EIT を先頭に置くため、
    // 実際の「ファイル先頭」は PSI/SI パケットの後になるが、
    // 補正で使うのは PCR 同士の相対的な経過時間 (5 秒) だけなので影響しない
    const filePath = createTsFile('pcr-correction', packets);
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 10000 });

    const rawTdtAt = Date.UTC(2026, 6, 31, 22, 0, 0) - 9 * 3600 * 1000;
    assert.equal(info.firstTdtAt, rawTdtAt - 5000);
});

test('PCR サンプルが 1 つしかない場合は補正せず、TDT の時刻をそのまま使う', async () => {
    const videoPid = 0x0100;
    const audioPid = 0x0110;
    const serviceId = 1024;
    const transportStreamId = 0x7e87;
    const tdtTime = jstTimeBuffer(2026, 7, 31, 22, 0, 0);

    const packets = buildPcrTestPackets(videoPid, audioPid, serviceId, transportStreamId, [
        buildPcrPacket(videoPid, 2_000_000_000), // 基準点になれるサンプルが 1 つしか無い
        toPacket(PID_TDT, buildTdt(tdtTime), 0),
    ]);

    const filePath = createTsFile('pcr-single-sample', packets);
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 10000 });

    const rawTdtAt = Date.UTC(2026, 6, 31, 22, 0, 0) - 9 * 3600 * 1000;
    assert.equal(info.firstTdtAt, rawTdtAt);
});

test('対象サービスの PCR_PID が無い (0x1fff) 場合は補正せず、TDT の時刻をそのまま使う', async () => {
    const videoPid = 0x0100;
    const audioPid = 0x0110;
    const serviceId = 1024;
    const transportStreamId = 0x7e87;
    const tdtTime = jstTimeBuffer(2026, 7, 31, 22, 0, 0);

    // PMT の PCR_PID をあえて videoPid と違う PID にして、PCR サンプルとマッチしないようにする
    const packets = [
        toPacket(PID_PAT, buildPat(transportStreamId, serviceId, PID_PMT), 0),
        toPacket(PID_PMT, buildPmt(serviceId, 0x0200, audioPid), 0),
        toPacket(PID_SDT, buildSdt(transportStreamId, transportStreamId, serviceId, 'NHK', 'TEST TV'), 0),
        toPacket(
            PID_EIT,
            buildEit({
                serviceId,
                transportStreamId,
                originalNetworkId: transportStreamId,
                eventId: 12345,
                eventName: 'TEST PROGRAM',
                eventText: 'TEST TEXT',
                genre1: 0x7,
                subGenre1: 0x0,
                startTime: jstTimeBuffer(2026, 7, 31, 22, 0, 0),
                duration: bcdDuration(0, 30, 0),
            }),
            0,
        ),
        buildPcrPacket(videoPid, 2_000_000_000),
        buildPcrPacket(videoPid, 2_000_000_000 + 5 * 27_000_000),
        toPacket(PID_TDT, buildTdt(tdtTime), 0),
    ];

    const filePath = createTsFile('pcr-pid-mismatch', packets);
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 10000 });

    const rawTdtAt = Date.UTC(2026, 6, 31, 22, 0, 0) - 9 * 3600 * 1000;
    assert.equal(info.firstTdtAt, rawTdtAt);
});

test('相乗りしているワンセグ・データ放送ではなく、本編サービスの放送局名と番組を採用する', async () => {
    const transportStreamId = 0x7e87;
    const mainServiceId = 1024;
    const onesegServiceId = 1408;
    const mainPmtPid = 0x1000;
    const onesegPmtPid = 0x1001;

    const packets = [];
    // 同じ PID に複数のセクションを流すため、連続性カウンタは PID ごとに進める
    let eitCounter = 0;
    for (let i = 0; i < 4; i++) {
        // PAT はワンセグを先に載せる (先頭を採ると間違える状況を再現する)
        packets.push(
            toPacket(
                PID_PAT,
                buildPatMulti(transportStreamId, [
                    { serviceId: onesegServiceId, pmtPid: onesegPmtPid },
                    { serviceId: mainServiceId, pmtPid: mainPmtPid },
                ]),
                i,
            ),
        );
        packets.push(toPacket(onesegPmtPid, buildPmt(onesegServiceId, 0x1fc8, 0x1fc9), i));
        packets.push(toPacket(mainPmtPid, buildPmt(mainServiceId, 0x0100, 0x0110), i));
        packets.push(
            toPacket(
                PID_SDT,
                buildSdtMulti(transportStreamId, transportStreamId, [
                    // ワンセグはデータサービス (0xC0)
                    {
                        serviceId: onesegServiceId,
                        serviceType: 0xc0,
                        providerName: 'NHK',
                        serviceName: 'ONESEG',
                    },
                    {
                        serviceId: mainServiceId,
                        serviceType: 0x01,
                        providerName: 'NHK',
                        serviceName: 'TEST TV',
                    },
                ]),
                i,
            ),
        );
        // EIT[p/f] は両サービス分流れてくる。ワンセグの方が先に現れる
        packets.push(
            toPacket(
                PID_EIT,
                buildEit({
                    serviceId: onesegServiceId,
                    transportStreamId,
                    originalNetworkId: transportStreamId,
                    eventId: 999,
                    eventName: 'ONESEG PROGRAM',
                    eventText: 'ONESEG TEXT',
                    genre1: 0x0,
                    subGenre1: 0x0,
                    startTime: jstTimeBuffer(2026, 7, 31, 22, 0, 0),
                    duration: bcdDuration(0, 30, 0),
                }),
                eitCounter++,
            ),
        );
        packets.push(
            toPacket(
                PID_EIT,
                buildEit({
                    serviceId: mainServiceId,
                    transportStreamId,
                    originalNetworkId: transportStreamId,
                    eventId: 12345,
                    eventName: 'TEST PROGRAM',
                    eventText: 'TEST TEXT',
                    genre1: 0x7,
                    subGenre1: 0x0,
                    startTime: jstTimeBuffer(2026, 7, 31, 22, 0, 0),
                    duration: bcdDuration(0, 30, 0),
                }),
                eitCounter++,
            ),
        );
        packets.push(toPacket(PID_TDT, buildTdt(jstTimeBuffer(2026, 7, 31, 21, 59, 55)), i));
    }

    const filePath = createTsFile('multi-service', packets);
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 10000 });

    assert.equal(info.serviceId, mainServiceId);
    assert.equal(info.serviceType, 0x01);
    assert.equal(info.serviceName, 'ＴＥＳＴ　ＴＶ');
    assert.equal(info.eventId, 12345);
    assert.equal(info.eventName, 'ＴＥＳＴ　ＰＲＯＧＲＡＭ');
    assert.deepEqual(info.genres, [{ lv1: 0x7, lv2: 0x0 }]);
    assert.equal(info.videoPid, 0x0100);
    assert.equal(info.audioPid, 0x0110);
});

// --- ファイル中央からの解析 ---

// MIN_MIDDLE_ANALYZE_BYTES (64MB) を超えるサイズにして中央からの解析を働かせる
const MIDDLE_TEST_TOTAL_PACKETS = 380000; // 71.44MB
const MIDDLE_TEST_MIDDLE_INDEX = MIDDLE_TEST_TOTAL_PACKETS / 2;
// 1000 パケット (188000 byte) ごとに 100ms 進む PCR = 1880 byte/ms (約 15Mbps)
const MIDDLE_TEST_PCR_INTERVAL_PACKETS = 1000;
const MIDDLE_TEST_PCR_INTERVAL_TICKS = 100 * 27000;
const MIDDLE_TEST_BYTES_PER_MS = (MIDDLE_TEST_PCR_INTERVAL_PACKETS * 188) / 100;
// ファイル先頭から中央までの経過時間 (バイト数 / バイトレート)。ちょうど 19 秒になる
const MIDDLE_TEST_ELAPSED_SEC = (MIDDLE_TEST_MIDDLE_INDEX * 188) / MIDDLE_TEST_BYTES_PER_MS / 1000;

/**
 * 先頭に前番組、中央に本番組の PSI/SI を置いた大きな TS を作る
 */
function createMiddleAnalyzeTsFile(name) {
    const transportStreamId = 0x7e87;
    const serviceId = 1024;
    const videoPid = 0x0100;
    const audioPid = 0x0110;

    const psi = (eit, tdtTime, counter) => [
        toPacket(PID_PAT, buildPat(transportStreamId, serviceId, PID_PMT), counter),
        toPacket(PID_PMT, buildPmt(serviceId, videoPid, audioPid), counter),
        toPacket(
            PID_SDT,
            buildSdt(transportStreamId, transportStreamId, serviceId, 'NHK', 'TEST TV'),
            counter,
        ),
        toPacket(PID_EIT, buildEit(eit), counter),
        toPacket(PID_TDT, buildTdt(tdtTime), counter),
    ];

    const blocks = [];

    // ファイル先頭: 前番組の EIT[p/f] がまだ present として流れている
    blocks.push({
        index: 0,
        packets: psi(
            {
                serviceId,
                transportStreamId,
                originalNetworkId: transportStreamId,
                eventId: 1111,
                eventName: 'PREV PROGRAM',
                eventText: 'PREV TEXT',
                genre1: 0x0,
                subGenre1: 0x0,
                startTime: jstTimeBuffer(2026, 7, 31, 16, 30, 0),
                duration: bcdDuration(0, 30, 0),
            },
            // 中央の TDT (22:00:00) からバイトレート分 (19 秒) だけ遡った、実際のファイル先頭の時刻
            jstTimeBuffer(2026, 7, 31, 21, 59, 41),
            0,
        ),
    });

    // ファイル中央以降: 本番組。実際の放送と同じくテーブルを繰り返し送る
    for (let r = 0; r < 25; r++) {
        blocks.push({
            index: MIDDLE_TEST_MIDDLE_INDEX + r * MIDDLE_TEST_PCR_INTERVAL_PACKETS,
            packets: [
                buildPcrPacket(videoPid, 2_000_000_000 + r * MIDDLE_TEST_PCR_INTERVAL_TICKS),
                ...psi(
                    {
                        serviceId,
                        transportStreamId,
                        originalNetworkId: transportStreamId,
                        eventId: 12345,
                        eventName: 'MAIN PROGRAM',
                        eventText: 'MAIN TEXT',
                        genre1: 0x7,
                        subGenre1: 0x0,
                        startTime: jstTimeBuffer(2026, 7, 31, 21, 0, 0),
                        duration: bcdDuration(2, 0, 0),
                    },
                    jstTimeBuffer(2026, 7, 31, 22, 0, 0),
                    r & 0x0f,
                ),
            ],
        });
    }

    return createLargeTsFile(name, MIDDLE_TEST_TOTAL_PACKETS, blocks);
}

test('ファイル中央の EIT[p/f] を採用し、先頭に残る前番組の情報は採らない', async () => {
    const filePath = createMiddleAnalyzeTsFile('middle');
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 30000 });

    assert.equal(info.eventId, 12345);
    assert.equal(info.eventName, 'ＭＡＩＮ　ＰＲＯＧＲＡＭ');
    assert.deepEqual(info.genres, [{ lv1: 0x7, lv2: 0x0 }]);
    assert.equal(info.eventStartAt, Date.UTC(2026, 6, 31, 21, 0, 0) - 9 * 3600 * 1000);
});

test('中央から解析しても firstTdtAt はファイル先頭の放送時刻になる', async () => {
    const filePath = createMiddleAnalyzeTsFile('middle-tdt');
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 30000 });

    // 中央の TDT は 22:00:00。ファイル先頭はその 19 秒前を指しているはず
    assert.equal(MIDDLE_TEST_ELAPSED_SEC, 19);
    assert.equal(info.firstTdtAt, Date.UTC(2026, 6, 31, 21, 59, 41) - 9 * 3600 * 1000);
});

test('analyzeFromMiddle: false ならファイル先頭から解析する (従来動作)', async () => {
    const filePath = createMiddleAnalyzeTsFile('middle-disabled');
    const info = await createAnalyzer().analyze(filePath, { timeoutMs: 30000, analyzeFromMiddle: false });

    // 先頭から読むと前番組の EIT[p/f] を拾ってしまう
    assert.equal(info.eventId, 1111);
    assert.equal(info.eventName, 'ＰＲＥＶ　ＰＲＯＧＲＡＭ');
});

// --- ファイル先頭時刻の決定 (resolveFileStartAt) ---
// scanHeadTime は実ファイル I/O を伴うためスタブし、head と見積もりの採否だけを固定する
function callResolveFileStartAt(headAt, result, startPosition = 64 * 1024 * 1024) {
    const warns = [];
    const context = {
        scanHeadTime: async () => headAt,
        log: {
            system: { info: () => {}, warn: m => warns.push(m), error: () => {}, debug: () => {} },
        },
    };

    return TsInfoAnalyzer.prototype.resolveFileStartAt
        .call(context, 'dummy.ts', startPosition, result, 1000)
        .then(v => ({ value: v, warns: warns }));
}

test('先頭の TDT/TOT が読めたら、見積もりと大きく食い違っても先頭を採る', async () => {
    // tsreplace の HEVC 出力は VBR で、中央の実測バイトレートからの外挿が数分ずれる。
    // 実測では head 08:29:41 / estimated 08:21:52 (7 分 48 秒差) で head が正しかった
    const headAt = Date.parse('2026-08-22T08:29:41.171Z');
    const regionStartAt = Date.parse('2026-08-22T09:00:00.000Z');
    const startPosition = 64 * 1024 * 1024;
    // 見積もりが head より 7 分 48 秒手前になるようなバイトレートを与える
    const estimatedElapsedMs = regionStartAt - (headAt - 468000);
    const result = {
        regionStartAt: regionStartAt,
        bytesPerMs: startPosition / estimatedElapsedMs,
        pcrPid: 0x1000,
    };

    const { value, warns } = await callResolveFileStartAt(headAt, result, startPosition);

    assert.equal(value, headAt);
    assert.deepEqual(warns, []);
});

test('先頭が読めなければ中央からの見積もりを使う', async () => {
    const regionStartAt = Date.parse('2026-08-22T09:00:00.000Z');
    const startPosition = 64 * 1024 * 1024;
    const result = {
        regionStartAt: regionStartAt,
        bytesPerMs: startPosition / 600000, // 10 分ぶん
        pcrPid: 0x1000,
    };

    const { value } = await callResolveFileStartAt(null, result, startPosition);

    assert.equal(value, regionStartAt - 600000);
});

test('先頭の時刻が中央より後なら、壊れているとみなして見積もりへ退避する', async () => {
    const regionStartAt = Date.parse('2026-08-22T09:00:00.000Z');
    const headAt = regionStartAt + 60000; // 時系列としてあり得ない
    const startPosition = 64 * 1024 * 1024;
    const result = {
        regionStartAt: regionStartAt,
        bytesPerMs: startPosition / 600000,
        pcrPid: 0x1000,
    };

    const { value, warns } = await callResolveFileStartAt(headAt, result, startPosition);

    assert.equal(value, regionStartAt - 600000);
    assert.equal(warns.length, 1);
    assert.ok(warns[0].includes('head time is newer than region time'));
});

test('先頭も見積もりも得られなければ null を返す', async () => {
    const result = { regionStartAt: null, bytesPerMs: null, pcrPid: null };

    const { value } = await callResolveFileStartAt(null, result);

    assert.equal(value, null);
});

test('見積もりが立たなくても先頭が読めていればそれを使う', async () => {
    const headAt = Date.parse('2026-08-22T08:29:41.171Z');
    const result = { regionStartAt: null, bytesPerMs: null, pcrPid: null };

    const { value } = await callResolveFileStartAt(headAt, result);

    assert.equal(value, headAt);
});
