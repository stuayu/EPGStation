'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SyobocalProgramLookup = require('../../dist/model/metadata/syobocal/SyobocalProgramLookup').default;

const START_AT = Date.parse('2026-08-01T23:00:00+09:00');

function progXml(items) {
    const body = items
        .map(
            x =>
                `<ProgItem><PID>${x.pid}</PID><TID>${x.tid}</TID><StTime>${x.stTime}</StTime><EdTime>${x.edTime}</EdTime><Count>${x.count ?? ''}</Count><SubTitle>${x.subTitle ?? ''}</SubTitle></ProgItem>`,
        )
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><ProgLookupResponse><ProgItems>${body}</ProgItems></ProgLookupResponse>`;
}

function stubLogger() {
    return { getLogger: () => ({ system: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } }) };
}
function stubHttp(xml) {
    return { urls: [], get: async function (url) { this.urls.push(url); return { text: xml }; }, post: async () => ({ text: '' }) };
}
function lookup(http, option = {}) {
    return new SyobocalProgramLookup(
        stubLogger(),
        http,
        { getAll: async () => ({ metadata: { syobocal: { enabled: option.enabled !== false } } }) },
        { findId: async () => option.channel ?? { id: 1, networkId: 32736, serviceId: 1024 } },
        { find: () => ('mapping' in option ? option.mapping : { chId: 19, syobocal: true }) },
        { getConfig: () => ({ featureFlags: {} }) },
        { resolve: async () => 'http://cal.syoboi.jp/db.php' },
    );
}

test('resolves tid / episode number / subtitle from the channel and start time', async () => {
    const http = stubHttp(
        progXml([
            { pid: 1, tid: 100, stTime: '2026-08-01 22:30:00', edTime: '2026-08-01 23:00:00', count: 15, subTitle: '前の番組' },
            { pid: 2, tid: 200, stTime: '2026-08-01 23:00:00', edTime: '2026-08-01 23:30:00', count: 16, subTitle: '猫猫の推理' },
        ]),
    );
    const match = await lookup(http).lookup(1, START_AT);
    assert.equal(match.tid, 200);
    assert.equal(match.count, 16);
    assert.equal(match.subTitle, '猫猫の推理');
    // 放送日 (JST 5 時境界) 1 日分をまとめて取得する
    assert.ok(http.urls[0].includes('Command=ProgLookup'));
    assert.ok(http.urls[0].includes('ChID=19'));
    assert.ok(http.urls[0].includes('Range=20260801_050000-20260802_050000'));
});

test('falls back to the programme that contains the start time when it does not start exactly', async () => {
    // 録画開始が番組開始から 20 分ずれている (許容誤差の 5 分を超える) ケース
    const http = stubHttp(
        progXml([{ pid: 1, tid: 300, stTime: '2026-08-01 22:40:00', edTime: '2026-08-01 23:10:00', count: 7, subTitle: '途中から' }]),
    );
    const match = await lookup(http).lookup(1, START_AT);
    assert.equal(match.tid, 300);
    assert.equal(match.count, 7);
});

test('picks the nearest programme within the tolerance', async () => {
    const http = stubHttp(
        progXml([
            { pid: 1, tid: 400, stTime: '2026-08-01 23:04:00', edTime: '2026-08-01 23:34:00', count: 1 },
            { pid: 2, tid: 500, stTime: '2026-08-01 23:01:00', edTime: '2026-08-01 23:31:00', count: 2 },
        ]),
    );
    const match = await lookup(http).lookup(1, START_AT);
    assert.equal(match.tid, 500);
});

test('returns null when no programme matches the start time', async () => {
    const http = stubHttp(
        progXml([{ pid: 1, tid: 600, stTime: '2026-08-01 10:00:00', edTime: '2026-08-01 10:30:00', count: 1 }]),
    );
    assert.equal(await lookup(http).lookup(1, START_AT), null);
});

test('caches the day of programmes so repeated recordings hit the network once', async () => {
    const http = stubHttp(
        progXml([{ pid: 1, tid: 700, stTime: '2026-08-01 23:00:00', edTime: '2026-08-01 23:30:00', count: 3 }]),
    );
    const model = lookup(http);
    await model.lookup(1, START_AT);
    await model.lookup(1, START_AT);
    assert.equal(http.urls.length, 1);
});

test('does nothing when the syobocal integration is disabled', async () => {
    const http = stubHttp(progXml([]));
    assert.equal(await lookup(http, { enabled: false }).lookup(1, START_AT), null);
    assert.equal(http.urls.length, 0);
});

test('skips channels that are not mapped to a syobocal ChID', async () => {
    const http = stubHttp(progXml([]));
    assert.equal(await lookup(http, { mapping: undefined }).lookup(1, START_AT), null);
    // 未登録局 (syobocal: false) も放送予定を持たないので問い合わせない
    assert.equal(await lookup(http, { mapping: { chId: 19, syobocal: false } }).lookup(1, START_AT), null);
    assert.equal(http.urls.length, 0);
});

test('returns null instead of throwing when the request fails', async () => {
    const http = { urls: [], get: async () => { throw new Error('network error'); }, post: async () => ({ text: '' }) };
    assert.equal(await lookup(http).lookup(1, START_AT), null);
});

test('rejects invalid start times without touching the network', async () => {
    const http = stubHttp(progXml([]));
    assert.equal(await lookup(http).lookup(1, 0), null);
    assert.equal(await lookup(http).lookup(1, Number.NaN), null);
    assert.equal(http.urls.length, 0);
});
