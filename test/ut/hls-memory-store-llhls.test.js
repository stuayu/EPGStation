'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const HLSMemoryStoreModel = require('../../dist/model/service/stream/util/HLSMemoryStoreModel').default;

// in-memory HLS ストアの LL-HLS (#EXT-X-PART / ブロッキングプレイリスト要求) 対応を検証する。

const logger = {
    getLogger: () => ({
        stream: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
        system: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    }),
};

/**
 * パート 2 つで 1 セグメントを構成しながらストアへ流し込む
 * @param store: HLSMemoryStoreModel
 * @param streamId: number
 * @param segmentNum: number 追加するセグメント数
 * @param partDuration: number パート 1 つの継続時間 (秒)
 */
function pushSegments(store, streamId, segmentNum, partDuration = 0.5) {
    for (let i = 0; i < segmentNum; i++) {
        const first = Buffer.from(`seg${i}-part0`);
        const second = Buffer.from(`seg${i}-part1`);
        store.addPart(streamId, first, partDuration, true);
        store.addPart(streamId, second, partDuration, false);
        store.addSegment(streamId, Buffer.concat([first, second]), partDuration * 2);
    }
}

test('プレイリストに LL-HLS のタグ (SERVER-CONTROL / PART-INF / PART / PRELOAD-HINT) が出る', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 3);

    const playlist = store.getPlaylist(1);
    assert.ok(playlist !== null);

    assert.match(playlist, /#EXT-X-VERSION:9/);
    assert.match(playlist, /#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1\.500/);
    assert.match(playlist, /#EXT-X-PART-INF:PART-TARGET=0\.500/);
    assert.match(playlist, /#EXT-X-MAP:URI="stream1-init\.mp4"/);
    // 先頭パートだけ INDEPENDENT=YES (キーフレーム始まり)
    assert.match(playlist, /#EXT-X-PART:DURATION=0\.50000,URI="stream1-2\.0\.part\.m4s",INDEPENDENT=YES/);
    assert.match(playlist, /#EXT-X-PART:DURATION=0\.50000,URI="stream1-2\.1\.part\.m4s"\n/);
    // 次に生成されるパートを先行要求させる
    assert.match(playlist, /#EXT-X-PRELOAD-HINT:TYPE=PART,URI="stream1-3\.0\.part\.m4s"/);
    // セグメント自体も従来どおり載る
    assert.match(playlist, /#EXTINF:1\.00000,\nstream1-2\.m4s/);
});

test('セグメント確定前でもパートがプレイリストに載る', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 2);

    // 3 セグメント目の 1 パート目だけを追加する (セグメントは未確定)
    store.addPart(1, Buffer.from('pending-part0'), 0.5, true);

    const playlist = store.getPlaylist(1);
    assert.match(playlist, /#EXT-X-PART:DURATION=0\.50000,URI="stream1-2\.0\.part\.m4s",INDEPENDENT=YES/);
    // 未確定セグメントの #EXTINF は出さない
    assert.doesNotMatch(playlist, /stream1-2\.m4s/);
    assert.match(playlist, /#EXT-X-PRELOAD-HINT:TYPE=PART,URI="stream1-2\.1\.part\.m4s"/);
});

test('生成済みのパートは即座に取得できる', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 1);

    assert.deepEqual(await store.getPart(1, 0, 0), Buffer.from('seg0-part0'));
    assert.deepEqual(await store.getPart(1, 0, 1), Buffer.from('seg0-part1'));
});

test('未生成のパート (PRELOAD-HINT) は生成されるまで待ってから返す', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 1);

    // まだ存在しないセグメント 1 のパート 0 を要求する
    const pending = store.getPart(1, 1, 0);

    let resolved = false;
    pending.then(() => {
        resolved = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, false, 'パート生成前に解決してはいけない');

    store.addPart(1, Buffer.from('seg1-part0'), 0.5, true);

    assert.deepEqual(await pending, Buffer.from('seg1-part0'));
});

test('ブロッキングプレイリスト要求 (_HLS_msn / _HLS_part) は該当パートが生成されるまで待つ', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 2);

    const pending = store.waitForPlaylist(1, { msn: 2, part: 1 });

    let resolved = false;
    pending.then(() => {
        resolved = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, false);

    // パート 0 だけでは条件を満たさない
    store.addPart(1, Buffer.from('seg2-part0'), 0.5, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, false);

    store.addPart(1, Buffer.from('seg2-part1'), 0.5, false);

    const playlist = await pending;
    assert.match(playlist, /#EXT-X-PART:DURATION=0\.50000,URI="stream1-2\.1\.part\.m4s"/);
});

test('_HLS_msn の指定が無ければ待たずに現在のプレイリストを返す', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 2);

    const playlist = await store.waitForPlaylist(1, {});
    assert.equal(playlist, store.getPlaylist(1));
});

test('破棄済みのパートを要求しても待たずに null を返す', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    // ライブは 12 セグメントまでしか保持しないため、先頭は破棄される
    store.addSegment(1, Buffer.from('seg0'), 1);
    store.getSegment(1, 0);
    pushSegments(store, 1, 15);

    assert.equal(await store.getPart(1, 0, 0), null);
});

test('取得前のセグメントは保持本数を超えても削除しない', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 15);

    // クライアントがまだ何も取得していないため、先頭 seq は保持する
    assert.deepEqual(store.getSegment(1, 0), Buffer.from('seg0-part0seg0-part1'));
});

test('古い msn のブロッキングプレイリスト要求は現在の playlist に置き換えない', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 15);

    assert.equal(store.isPlaylistRequestTooOld(1, 0), false);
    store.getSegment(1, 0);
    pushSegments(store, 1, 12);
    assert.equal(store.isPlaylistRequestTooOld(1, 0), true);
    assert.equal(await store.waitForPlaylist(1, { msn: 0, part: 0 }), null);
});

test('delete で待機中の要求を解決してレスポンスが返らなくなるのを防ぐ', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 1);

    const pending = store.getPart(1, 1, 0);
    store.delete(1);

    assert.equal(await pending, null);
});

test('recorded モードはライブより多くのセグメントを保持しプレイリストへ載せる', () => {
    const live = new HLSMemoryStoreModel(logger);
    live.create(1, 'live');
    live.setInit(1, Buffer.from('init'));
    pushSegments(live, 1, 30);

    const recorded = new HLSMemoryStoreModel(logger);
    recorded.create(2, 'recorded');
    recorded.setInit(2, Buffer.from('init'));
    pushSegments(recorded, 2, 30);

    const liveCount = (live.getPlaylist(1).match(/#EXTINF:/g) ?? []).length;
    const recordedCount = (recorded.getPlaylist(2).match(/#EXTINF:/g) ?? []).length;

    assert.equal(liveCount, 6);
    // 録画済みは巻き戻しに応えるため保持している 30 セグメントすべてを載せる
    assert.equal(recordedCount, 30);
});

test('recorded モードは再生開始位置をプレイリスト先頭へ固定する', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'recorded');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 2);

    assert.match(store.getPlaylist(1), /#EXT-X-START:TIME-OFFSET=0,PRECISE=YES/);
});

// 録画ファイルのエンコードは実時間より数倍速いため、放っておくと再生位置から際限なく先行し、
// 再生位置のセグメントが保持上限から押し出される。そうなると hls.js が
// synchronizeToLiveEdge() でエンコード最新位置へ強制シークしてしまうので、
// 先行量を測ってエンコードを止められるようにしている
test('getAheadSegmentNum はクライアントが取得した位置からの先行セグメント数を返す', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'recorded');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 20);

    // まだ 1 つも取得されていなければ先行量は測れない (0 を返す)
    assert.equal(store.getAheadSegmentNum(1), 0);

    // seq 5 まで取得済み → 確定済みの最新は seq 19 なので 14 セグメント先行
    store.getSegment(1, 5);
    assert.equal(store.getAheadSegmentNum(1), 14);

    // さらにエンコードが進めば先行量も増える
    pushSegments(store, 1, 3);
    assert.equal(store.getAheadSegmentNum(1), 17);

    // 追いつけば 0 に戻る
    store.getSegment(1, 22);
    assert.equal(store.getAheadSegmentNum(1), 0);
});

test('getAheadSegmentNum はパート取得でも更新される (LL-HLS はパート単位で取りに来る)', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'recorded');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 10);

    await store.getPart(1, 3, 0);
    assert.equal(store.getAheadSegmentNum(1), 6);
});

test('存在しないセグメント取得では lastServedSeq を更新しない', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'recorded');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 20);

    store.getSegment(1, 5);
    assert.equal(store.getAheadSegmentNum(1), 14);
    assert.equal(store.getSegment(1, 99), null);
    assert.equal(store.getAheadSegmentNum(1), 14);
});

test('古いセグメントの再取得では先読み基準を後退させない', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'recorded');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 20);

    store.getSegment(1, 10);
    assert.equal(store.getAheadSegmentNum(1), 9);
    store.getSegment(1, 2);
    assert.equal(store.getAheadSegmentNum(1), 9);
});

test('存在しないパート取得では lastServedSeq を更新しない', async () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'recorded');
    store.setInit(1, Buffer.from('init'));
    pushSegments(store, 1, 20);

    await store.getPart(1, 5, 0);
    assert.equal(store.getAheadSegmentNum(1), 14);
    assert.equal(await store.getPart(1, 99, 0), null);
    assert.equal(store.getAheadSegmentNum(1), 14);
});

test('存在しないストリームの getAheadSegmentNum は 0', () => {
    const store = new HLSMemoryStoreModel(logger);

    assert.equal(store.getAheadSegmentNum(99), 0);
});

test('addPart を経由しない addSegment はセグメント全体を 1 パートとして扱う', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(1, 'live');
    store.setInit(1, Buffer.from('init'));
    store.addSegment(1, Buffer.from('seg0'), 1);
    store.addSegment(1, Buffer.from('seg1'), 1);

    assert.equal(store.isReady(1), true);
    const playlist = store.getPlaylist(1);
    assert.match(playlist, /#EXT-X-PART:DURATION=1\.00000,URI="stream1-1\.0\.part\.m4s",INDEPENDENT=YES/);
    assert.deepEqual(store.getSegment(1, 1), Buffer.from('seg1'));
});
