'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const TsPlaybackTimeResolver = require('../../dist/model/recorded/ts/TsPlaybackTimeResolver').default;

const TS_PACKET_SIZE = 188;
const PCR_BASE_WRAP = Math.pow(2, 33);

function encodePcr(base, extension = 0) {
    const b = Buffer.alloc(6);
    b[0] = Math.floor(base / Math.pow(2, 25)) & 0xff;
    b[1] = Math.floor(base / Math.pow(2, 17)) & 0xff;
    b[2] = Math.floor(base / Math.pow(2, 9)) & 0xff;
    b[3] = Math.floor(base / 2) & 0xff;
    b[4] = ((base % 2) << 7) | 0x7e | ((extension >> 8) & 0x01);
    b[5] = extension & 0xff;

    return b;
}

function encodePts(pts) {
    const b = Buffer.alloc(5);
    const high = Math.floor(pts / Math.pow(2, 30)) & 0x07;
    const midHigh = Math.floor(pts / Math.pow(2, 22)) & 0xff;
    const midLow = Math.floor(pts / Math.pow(2, 15)) & 0x7f;
    const lowHigh = Math.floor(pts / Math.pow(2, 7)) & 0xff;
    const low = pts & 0x7f;
    b[0] = 0x20 | (high << 1) | 0x01;
    b[1] = midHigh;
    b[2] = (midLow << 1) | 0x01;
    b[3] = lowHigh;
    b[4] = (low << 1) | 0x01;

    return b;
}

function buildPcrPacket(pid, pcrBase) {
    const packet = Buffer.alloc(TS_PACKET_SIZE, 0xff);
    packet[0] = 0x47;
    packet[1] = (pid >> 8) & 0x1f;
    packet[2] = pid & 0xff;
    packet[3] = 0x20; // adaptation field only
    packet[4] = 183;
    packet[5] = 0x10; // PCR_flag
    encodePcr(pcrBase).copy(packet, 6);

    return packet;
}

function buildPmtPacket(pid, serviceId, pcrPid) {
    const packet = Buffer.alloc(TS_PACKET_SIZE, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40 | ((pid >> 8) & 0x1f); // payload_unit_start_indicator
    packet[2] = pid & 0xff;
    packet[3] = 0x10; // payload only
    packet[4] = 0x00; // pointer_field

    const section = Buffer.from([
        0x02, // table_id = PMT
        0xb0,
        0x0d,
        (serviceId >> 8) & 0xff,
        serviceId & 0xff,
        0xc1,
        0x00,
        0x00,
        0xe0 | ((pcrPid >> 8) & 0x1f),
        pcrPid & 0xff,
        0xf0,
        0x00,
    ]);
    section.copy(packet, 5);

    return packet;
}

function buildPesPacket(pid, pts) {
    const packet = Buffer.alloc(TS_PACKET_SIZE, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40 | ((pid >> 8) & 0x1f); // payload_unit_start_indicator
    packet[2] = pid & 0xff;
    packet[3] = 0x10; // payload only

    const pesHeader = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x80, 0x80, 0x05]),
        encodePts(pts),
    ]);
    pesHeader.copy(packet, 4);

    return packet;
}

async function withTsFile(packets, callback) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-ts-time-'));
    const file = path.join(dir, 'sample.ts');
    try {
        await fs.writeFile(file, Buffer.concat(packets));
        await callback(file);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

function baseInfo(overrides) {
    return Object.assign(
        {
            serviceId: 101,
            videoPid: 0x0101,
            audioPid: 0x0102,
            firstTdtAt: Date.UTC(2026, 7, 22, 10, 0, 0),
        },
        overrides,
    );
}

test('先頭PCRと最初の映像PTSの差を実時刻へ反映する', async () => {
    const pcrPid = 0x0100;
    const pcrBase = 90_000 * 100;
    const videoPts = pcrBase + 90_000 * 2.5;

    await withTsFile(
        [buildPcrPacket(pcrPid, pcrBase), buildPmtPacket(0x0064, 101, pcrPid), buildPesPacket(0x0101, videoPts)],
        async file => {
            const info = baseInfo();
            const result = await TsPlaybackTimeResolver.resolve(file, info);
            assert.equal(result, info.firstTdtAt + 2500);
        },
    );
});

test('PCR/PTSが33bit境界を跨いでも正方向の差として算出する', async () => {
    const pcrPid = 0x0100;
    const pcrBase = PCR_BASE_WRAP - 45_000; // wrap の 0.5 秒前
    const videoPts = 45_000; // wrap の 0.5 秒後

    await withTsFile(
        [buildPcrPacket(pcrPid, pcrBase), buildPmtPacket(0x0064, 101, pcrPid), buildPesPacket(0x0101, videoPts)],
        async file => {
            const info = baseInfo();
            const result = await TsPlaybackTimeResolver.resolve(file, info);
            assert.equal(result, info.firstTdtAt + 1000);
        },
    );
});

test('映像PIDが無い場合は音声PTSを再生開始時刻として使う', async () => {
    const pcrPid = 0x0100;
    const pcrBase = 90_000 * 100;
    const audioPts = pcrBase - 90_000 * 0.25;

    await withTsFile(
        [buildPcrPacket(pcrPid, pcrBase), buildPmtPacket(0x0064, 101, pcrPid), buildPesPacket(0x0102, audioPts)],
        async file => {
            const info = baseInfo({ videoPid: null });
            const result = await TsPlaybackTimeResolver.resolve(file, info);
            assert.equal(result, info.firstTdtAt - 250);
        },
    );
});

test('先頭PCRとPTSが不自然に離れている場合は推測せずnullを返す', async () => {
    const pcrPid = 0x0100;
    const pcrBase = 90_000 * 100;
    const videoPts = pcrBase + 90_000 * 301;

    await withTsFile(
        [buildPcrPacket(pcrPid, pcrBase), buildPmtPacket(0x0064, 101, pcrPid), buildPesPacket(0x0101, videoPts)],
        async file => {
            assert.equal(await TsPlaybackTimeResolver.resolve(file, baseInfo()), null);
        },
    );
});

test('必要なTS情報が無ければファイルを読まずnullを返す', async () => {
    assert.equal(
        await TsPlaybackTimeResolver.resolve('/path/does/not/exist.ts', baseInfo({ firstTdtAt: null })),
        null,
    );
    assert.equal(
        await TsPlaybackTimeResolver.resolve('/path/does/not/exist.ts', baseInfo({ serviceId: null })),
        null,
    );
    assert.equal(
        await TsPlaybackTimeResolver.resolve(
            '/path/does/not/exist.ts',
            baseInfo({ videoPid: null, audioPid: null }),
        ),
        null,
    );
});

/**
 * discontinuity_indicator を立てた PCR パケット
 */
function buildDiscontinuityPcrPacket(pid, pcrBase) {
    const packet = buildPcrPacket(pid, pcrBase);
    packet[5] = 0x90; // discontinuity_indicator = 1, PCR_flag = 1

    return packet;
}

test('先頭PCRの後にPCRが不連続になった場合は推測せずnullを返す', async () => {
    const pcrPid = 0x0100;
    const pcrBase = 90_000 * 100;

    await withTsFile(
        [
            buildPcrPacket(pcrPid, pcrBase),
            buildPmtPacket(0x0064, 101, pcrPid),
            // ここで時間軸が切り替わるため、この後の PTS との差は経過時間にならない
            buildDiscontinuityPcrPacket(pcrPid, 90_000 * 500),
            buildPesPacket(0x0101, 90_000 * 500 + 90_000 * 2.5),
        ],
        async file => {
            assert.equal(await TsPlaybackTimeResolver.resolve(file, baseInfo()), null);
        },
    );
});

test('ファイル先頭 (基準の PCR より前) の不連続は開始点なので無視する', async () => {
    const pcrPid = 0x0100;
    const pcrBase = 90_000 * 100;

    await withTsFile(
        [
            buildDiscontinuityPcrPacket(pcrPid, pcrBase),
            buildPmtPacket(0x0064, 101, pcrPid),
            buildPesPacket(0x0101, pcrBase + 90_000 * 2.5),
        ],
        async file => {
            const info = baseInfo();
            assert.equal(await TsPlaybackTimeResolver.resolve(file, info), info.firstTdtAt + 2500);
        },
    );
});
