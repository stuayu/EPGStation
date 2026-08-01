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
        {
            updateCache: async () => {},
            getAffiliation: () => ('affiliation' in option ? option.affiliation : null),
            getAffiliations: () => [],
            isAffiliationChannelType: () => true,
        },
    );
}

test('resolves tid / episode number / subtitle from the channel and start time', async () => {
    const http = stubHttp(
        progXml([
            { pid: 1, tid: 100, stTime: '2026-08-01 22:30:00', edTime: '2026-08-01 23:00:00', count: 15, subTitle: '前の番組' },
            { pid: 2, tid: 200, stTime: '2026-08-01 23:00:00', edTime: '2026-08-01 23:30:00', count: 16, subTitle: '猫猫の推理' },
        ]),
    );
    const match = (await lookup(http).lookup(1, START_AT)).match;
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
    const match = (await lookup(http).lookup(1, START_AT)).match;
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
    const match = (await lookup(http).lookup(1, START_AT)).match;
    assert.equal(match.tid, 500);
});

test('returns null when no programme matches the start time', async () => {
    const http = stubHttp(
        progXml([{ pid: 1, tid: 600, stTime: '2026-08-01 10:00:00', edTime: '2026-08-01 10:30:00', count: 1 }]),
    );
    assert.equal((await lookup(http).lookup(1, START_AT)).match, null);
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
    assert.equal((await lookup(http, { enabled: false }).lookup(1, START_AT)).match, null);
    assert.equal(http.urls.length, 0);
});

test('skips channels that are neither mapped nor resolvable to a key station', async () => {
    const http = stubHttp(progXml([]));
    assert.equal((await lookup(http, { mapping: undefined }).lookup(1, START_AT)).match, null);
    // 未登録局 (syobocal: false) も、系列が分からなければ問い合わせ先が無い
    assert.equal((await lookup(http, { mapping: { chId: 19, syobocal: false } }).lookup(1, START_AT)).match, null);
    assert.equal(http.urls.length, 0);
});

// しょぼいカレンダーに放送データが無い地方局は、系列のキー局の放送予定で代用する
test('falls back to the key station of the affiliation for unregistered local channels', async () => {
    const http = stubHttp(
        progXml([{ pid: 1, tid: 800, stTime: '2026-08-01 23:00:00', edTime: '2026-08-01 23:30:00', count: 9, subTitle: '同時ネット' }]),
    );
    const match = (await lookup(http, { mapping: undefined, affiliation: { id: 'ntv', name: '日テレ系', order: 3 } }).lookup(1, START_AT)).match;
    assert.equal(match.tid, 800);
    assert.equal(match.count, 9);
    // 呼び出し側が「作品の確定には使えない」と判断できるよう印を付ける
    assert.equal(match.viaKeyStation, true);
    // 日本テレビの ChID (しょぼいカレンダーの実データでは 4) で問い合わせる
    assert.ok(http.urls[0].includes('ChID=4'));
});

// 遅れ放送ではキー局の同時刻に別番組が並ぶため、時間帯の包含では拾わない
test('a key station fallback only accepts programmes that start at the same time', async () => {
    const http = stubHttp(
        progXml([{ pid: 1, tid: 900, stTime: '2026-08-01 22:40:00', edTime: '2026-08-01 23:10:00', count: 5 }]),
    );
    const match = (await lookup(http, { mapping: undefined, affiliation: { id: 'tbs', name: 'TBS系', order: 5 } }).lookup(1, START_AT)).match;
    assert.equal(match, null);
});

// 独立系にキー局は無い
test('an independent station has no key station to fall back to', async () => {
    const http = stubHttp(progXml([]));
    const match = (await lookup(http, { mapping: undefined, affiliation: { id: 'independent', name: '独立系', order: 90 } }).lookup(1, START_AT)).match;
    assert.equal(match, null);
    assert.equal(http.urls.length, 0);
});

// 直接マッピングがある局はキー局を経由しない
test('a directly mapped channel is not flagged as a key station fallback', async () => {
    const http = stubHttp(
        progXml([{ pid: 1, tid: 1000, stTime: '2026-08-01 23:00:00', edTime: '2026-08-01 23:30:00', count: 1 }]),
    );
    const match = (await lookup(http).lookup(1, START_AT)).match;
    assert.equal(match.viaKeyStation, false);
});

test('returns null instead of throwing when the request fails', async () => {
    const http = { urls: [], get: async () => { throw new Error('network error'); }, post: async () => ({ text: '' }) };
    assert.equal((await lookup(http).lookup(1, START_AT)).match, null);
});

test('rejects invalid start times without touching the network', async () => {
    const http = stubHttp(progXml([]));
    assert.equal((await lookup(http).lookup(1, 0)).match, null);
    assert.equal((await lookup(http).lookup(1, Number.NaN)).match, null);
    assert.equal(http.urls.length, 0);
});

// --- 遅れ放送の話数解決 (lookupDelayed) ---
// しょぼいカレンダー未登録の県域局は、キー局の数日後に同じ作品を流す。
// 作品 (TID) が確定していれば、キー局の放送予定をその作品に絞って遡れる
test('lookupDelayed() picks the latest key-station broadcast of the work before the recording', async () => {
    const http = stubHttp(
        progXml([
            { pid: 1, tid: 7892, stTime: '2026-07-19 01:05:00', edTime: '2026-07-19 01:35:00', count: 3 },
            { pid: 2, tid: 7892, stTime: '2026-07-26 00:55:00', edTime: '2026-07-26 01:25:00', count: 4, subTitle: 'サブ4' },
            { pid: 3, tid: 7892, stTime: '2026-08-02 00:55:00', edTime: '2026-08-02 01:25:00', count: 5 },
        ]),
    );
    // 未登録局 (mapping なし) + 日テレ系
    const model = lookup(http, { mapping: undefined, affiliation: { id: 'ntv', name: '日テレ系', order: 3 } });
    const match = await model.lookupDelayed(1, Date.parse('2026-08-01T02:06:00+09:00'), 7892);

    // 8/1 の録画に対応するのは 7/26 放送の第 4 話 (8/2 の第 5 話はまだ流れていない)
    assert.equal(match.count, 4);
    assert.equal(match.subTitle, 'サブ4');
    assert.equal(match.viaKeyStation, true);
    // キー局 (日本テレビ = ChID 4) の放送予定を作品で絞って引く
    assert.ok(http.urls[0].includes('ChID=4'));
    assert.ok(http.urls[0].includes('TID=7892'));
});

test('lookupDelayed() ignores broadcasts of other works', async () => {
    const http = stubHttp(
        progXml([{ pid: 1, tid: 999, stTime: '2026-07-26 00:55:00', edTime: '2026-07-26 01:25:00', count: 4 }]),
    );
    const model = lookup(http, { mapping: undefined, affiliation: { id: 'ntv', name: '日テレ系', order: 3 } });

    assert.equal(await model.lookupDelayed(1, Date.parse('2026-08-01T02:06:00+09:00'), 7892), null);
});

test('lookupDelayed() does nothing for a channel that has its own schedule', async () => {
    const http = stubHttp(progXml([]));
    // 直接マッピングがある局はその局の放送予定で決まるので、遅れ放送の照会は行わない
    assert.equal(await lookup(http).lookupDelayed(1, START_AT, 100), null);
    assert.equal(http.urls.length, 0);
});

test('lookupDelayed() does nothing when the affiliation is unknown', async () => {
    const http = stubHttp(progXml([]));
    const model = lookup(http, { mapping: undefined, affiliation: null });

    assert.equal(await model.lookupDelayed(1, START_AT, 100), null);
    assert.equal(http.urls.length, 0);
});

// 一時的な取得失敗で空になったのか、本当にその日は放送が無いのかを完全には見分けられないので、
// 0 件はキャッシュせず次回引き直す (空を数時間持ち回って復旧を遅らせない)
test('an empty result is not cached so the next lookup retries', async () => {
    const http = stubHttp(progXml([]));
    const model = lookup(http);
    await model.lookup(1, START_AT);
    await model.lookup(1, START_AT);
    assert.equal(http.urls.length, 2);
});

// Cloudflare のレート制限などで XML 以外が返った場合は「該当なし」ではなく取得失敗として扱う
test('a non-XML response is treated as a failure, not as "no programme"', async () => {
    const http = stubHttp('<!doctype html><html><title>Access denied | cal.syoboi.jp</title></html>');
    const model = lookup(http);
    assert.equal((await model.lookup(1, START_AT)).match, null);
    // 失敗はキャッシュされないので次回また取りに行く
    assert.equal((await model.lookup(1, START_AT)).match, null);
    assert.equal(http.urls.length, 2);
});

// 引けなかったときに「どの ChID を引いて何件返ったか」を返す (画面とログで切り分けるため)
test('lookup() explains why a programme could not be resolved', async () => {
    const notMapped = await lookup(stubHttp(progXml([])), { mapping: undefined }).lookup(1, START_AT);
    assert.equal(notMapped.match, null);
    assert.match(notMapped.detail, /しょぼいカレンダー未対応/);

    const keyStation = await lookup(stubHttp(progXml([])), {
        mapping: undefined,
        affiliation: { id: 'ntv', name: '日テレ系', order: 3 },
    }).lookup(1, START_AT);
    assert.equal(keyStation.match, null);
    // 代用したキー局の ChID (日本テレビ = 4) と件数が分かる
    assert.match(keyStation.detail, /ChID 4/);
    assert.match(keyStation.detail, /0 件/);

    const disabled = await lookup(stubHttp(progXml([])), { enabled: false }).lookup(1, START_AT);
    assert.match(disabled.detail, /無効/);

    const failed = await lookup(stubHttp('<!doctype html><html></html>')).lookup(1, START_AT);
    assert.match(failed.detail, /取得に失敗/);
});
