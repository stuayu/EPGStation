'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { onEventStreamDisconnected, onEventStreamStarted } = require('../../dist/model/epgUpdater/EventStreamFallbackDecision');
const { selectEPGPollingChannels } = require('../../dist/model/epgUpdater/EPGPollingSelection');
const { getMirakurunProgramId, resolveEitOnAirProgram } = require('../../dist/model/api/schedule/EitOnAirResolver');

test('無イベント切断が閾値に達すると polling へ切り替え、stream 復活で戻る', () => {
    let state = { consecutiveSilentDisconnects: 0, polling: false };
    state = onEventStreamDisconnected(state, false, 2);
    assert.equal(state.polling, false);
    state = onEventStreamDisconnected(state, false, 2);
    assert.equal(state.polling, true);
    assert.deepEqual(onEventStreamStarted(), { consecutiveSilentDisconnects: 0, polling: false });
});

test('polling 対象はライブ、録画、予定の順に上限まで選ぶ', () => {
    assert.deepEqual(selectEPGPollingChannels([
        { channelId: 1, upcomingRecording: true }, { channelId: 2, activeStream: true },
        { channelId: 3, recording: true }, { channelId: 2, recording: true },
    ], 3), [2, 3, 1]);
});

test('EIT present は event id から導出した番組を選び、古ければ DB 判定へ戻る', () => {
    const id = getMirakurunProgramId(32416, 21504, 15501);
    const program = { id, channelId: 1, startAt: 0, endAt: 1, name: '正しい番組' };
    assert.equal(resolveEitOnAirProgram([program], { networkId: 32416, serviceId: 21504 }, {
        eventId: 15501, startAt: 0, durationSec: null, receivedAt: 1000, isFollowing: false,
    }, 2000).name, '正しい番組');
    assert.equal(resolveEitOnAirProgram([program], { networkId: 32416, serviceId: 21504 }, {
        eventId: 15501, startAt: 0, durationSec: null, receivedAt: 0, isFollowing: false,
    }, 2000, 1000), null);
});

test('EIT present の番組は Mirakurun の古い終了時刻でも現在番組として返す', () => {
    const id = getMirakurunProgramId(1, 2, 3);
    const program = { id, channelId: 1, startAt: 0, endAt: 1, name: '放送中' };
    assert.equal(resolveEitOnAirProgram([program], { networkId: 1, serviceId: 2 }, {
        eventId: 3, startAt: 0, durationSec: null, receivedAt: 1000, isFollowing: false,
    }, 10000).id, id);
});

// 配信中の TS から EIT を読む Transform は、TS を欠けさせずそのまま下流へ流すこと
// (data リスナで読むと flowing モードになり pipe 前のデータを落として映像が壊れる)
test('EitPresentCollectTransform は TS を素通しし、読み取った present をストアへ書く', async () => {
    const EitPresentCollectTransform = require('../../dist/model/service/stream/util/EitPresentCollectTransform').default;
    const updates = [];
    const store = { update: (channelId, record) => updates.push({ channelId, record }), get: () => null, clear: () => {} };
    const transform = new EitPresentCollectTransform(store, 3241621504);

    const input = Buffer.concat([Buffer.alloc(188, 0x47), Buffer.alloc(188, 0x47)]);
    const chunks = [];
    transform.on('data', c => chunks.push(c));
    await new Promise((resolve, reject) => {
        transform.on('end', resolve);
        transform.on('error', reject);
        transform.end(input);
    });

    // 入力した TS がそのまま下流へ流れること (欠けたら配信が壊れる)
    assert.deepEqual(Buffer.concat(chunks), input);
});

// 解析で例外が出ても配信を止めない
test('EitPresentCollectTransform は解析が失敗しても TS を流し続ける', async () => {
    const EitPresentCollectTransform = require('../../dist/model/service/stream/util/EitPresentCollectTransform').default;
    const store = {
        update: () => {
            throw new Error('store error');
        },
        get: () => null,
        clear: () => {},
    };
    const transform = new EitPresentCollectTransform(store, 1);
    const input = Buffer.alloc(376, 0x47);
    const chunks = [];
    transform.on('data', c => chunks.push(c));
    await new Promise((resolve, reject) => {
        transform.on('end', resolve);
        transform.on('error', reject);
        transform.end(input);
    });

    assert.deepEqual(Buffer.concat(chunks), input);
});

// EIT[p/f] は present と following が交互に流れてくる。同じ入れ物へ入れると
// 後から来た following が present を上書きし、放送中判定 (present しか見ない) が成立しなくなる
test('EitPresentStore は present と following を混ぜない', () => {
    const EitPresentStore = require('../../dist/model/service/stream/util/EitPresentStore').default;
    const store = new EitPresentStore();

    store.update(3241621504, { eventId: 5740, startAt: 1, durationSec: 360, receivedAt: 1, isFollowing: false });
    store.update(3241621504, { eventId: 5742, startAt: 2, durationSec: 600, receivedAt: 2, isFollowing: true });

    assert.equal(store.get(3241621504).eventId, 5740, 'following が来ても present は残ること');
    assert.equal(store.getFollowing(3241621504).eventId, 5742);

    store.clear(3241621504);
    assert.equal(store.get(3241621504), null);
});

// 相乗りサービス (ワンセグ・サブチャンネル) の EIT で本編を上書きしない
test('EitPresentCollectTransform は視聴中のサービス以外の EIT を捨てる', async () => {
    const EitPresentCollectTransform = require('../../dist/model/service/stream/util/EitPresentCollectTransform').default;
    const updates = [];
    const store = {
        update: (channelId, record) => {
            updates.push(record.eventId);

            return true;
        },
        get: () => null,
        getFollowing: () => null,
        clear: () => {},
    };
    const transform = new EitPresentCollectTransform(store, 3241621504, 21504);
    // パーサを差し替えて、本編 (21504) と相乗り (21505) の両方が流れてくる状況を作る
    transform.parser = {
        write: () => [
            { serviceId: 21504, eventId: 5740, startAt: 1, durationSec: 360, isFollowing: false },
            { serviceId: 21505, eventId: 9999, startAt: 1, durationSec: 360, isFollowing: false },
        ],
    };

    await new Promise((resolve, reject) => {
        transform.on('data', () => {});
        transform.on('end', resolve);
        transform.on('error', reject);
        transform.end(Buffer.alloc(188, 0x47));
    });

    assert.deepEqual(updates, [5740], '視聴中のサービスの EIT だけを採用すること');
});

// 放送波が「放送時間未定」と言っているなら、Mirakurun が確定した終了時刻を持っていても未定として返す
test('EIT の放送時間未定は Mirakurun の確定した終了時刻より優先する', () => {
    const { resolveEitBroadcastTime } = require('../../dist/model/api/schedule/EitOnAirResolver');
    const startAt = new Date('2026-08-30T12:00:00+09:00').getTime();
    const dbEndAt = startAt + 25 * 60 * 1000; // Mirakurun は 12:25 終了と言っている

    // duration 未定 (ARIB の 0xFFFFFF)
    const undefinedDuration = resolveEitBroadcastTime(
        { eventId: 5742, startAt: startAt, durationSec: null, receivedAt: startAt, isFollowing: false },
        startAt,
        dbEndAt,
    );
    assert.equal(undefinedDuration.isDurationUndefined, true);
    assert.equal(undefinedDuration.startAt, startAt);

    // duration が確定しているときは放送波の値で終了時刻を出す
    const fixedDuration = resolveEitBroadcastTime(
        { eventId: 5742, startAt: startAt, durationSec: 360, receivedAt: startAt, isFollowing: false },
        startAt,
        dbEndAt,
    );
    assert.equal(fixedDuration.isDurationUndefined, false);
    assert.equal(fixedDuration.endAt, startAt + 360 * 1000, 'Mirakurun の 25 分ではなく放送波の 6 分を使う');

    // EIT が開始時刻を持たない場合は DB の値へ退避する
    const noStart = resolveEitBroadcastTime(
        { eventId: 5742, startAt: null, durationSec: null, receivedAt: startAt, isFollowing: false },
        startAt,
        dbEndAt,
    );
    assert.equal(noStart.startAt, startAt);
});
