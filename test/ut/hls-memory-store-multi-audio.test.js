'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const HLSMemoryStoreModel = require('../../dist/model/service/stream/util/HLSMemoryStoreModel').default;
const Mp4CodecUtil = require('../../dist/model/service/stream/llhls/Mp4CodecUtil').default;

// 複数音声トラック分解モード (映像 'v' + 音声 'a0' / 'a1') のプレイリスト生成を検証する。
// マスタープレイリストの CODECS 属性と「レンディションは LL-HLS にしない」の 2 点が要。

const logger = {
    getLogger: () => ({
        stream: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
        system: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    }),
};

/** box を組み立てる (size + type + payload) */
function box(type, payload) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.length + 8, 0);
    header.write(type, 4, 'ascii');

    return Buffer.concat([header, payload]);
}

/** avc1 の sample entry を持つ最小の init セグメント (moov) を作る */
function createAvcInit(profile, compatibility, level) {
    // avcC: configurationVersion + profile + compatibility + level
    const avcC = box('avcC', Buffer.from([1, profile, compatibility, level]));
    // sample entry: 8 byte の box ヘッダ + 78 byte の固定領域の後に子 box が並ぶ
    const sampleEntry = box('avc1', Buffer.concat([Buffer.alloc(78), avcC]));
    const stsd = box('stsd', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), sampleEntry]));

    return box('moov', box('trak', box('mdia', box('minf', box('stbl', stsd)))));
}

/** mp4a の sample entry を持つ最小の init セグメント (moov) を作る */
function createAacInit() {
    const sampleEntry = box('mp4a', Buffer.alloc(78));
    const stsd = box('stsd', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), sampleEntry]));

    return box('moov', box('trak', box('mdia', box('minf', box('stbl', stsd)))));
}

function pushSegments(store, streamId, role, segmentNum) {
    for (let i = 0; i < segmentNum; i++) {
        const first = Buffer.from(`${role}-seg${i}-part0`);
        const second = Buffer.from(`${role}-seg${i}-part1`);
        store.addPart(streamId, first, 0.5, true, role);
        store.addPart(streamId, second, 0.5, false, role);
        store.addSegment(streamId, Buffer.concat([first, second]), 1, role);
    }
}

function createMultiTrackStore(streamId, mode = 'live') {
    const store = new HLSMemoryStoreModel(logger);
    for (const role of ['v', 'a0', 'a1']) {
        store.create(streamId, mode, role);
        store.setInit(streamId, role === 'v' ? createAvcInit(0x64, 0x00, 0x28) : createAacInit(), role);
        pushSegments(store, streamId, role, 3);
    }

    return store;
}

test('avc1 / mp4a の init セグメントから CODECS 用の文字列を読める', () => {
    assert.equal(Mp4CodecUtil.parseCodec(createAvcInit(0x64, 0x00, 0x28)), 'avc1.640028');
    assert.equal(Mp4CodecUtil.parseCodec(createAvcInit(0x42, 0xc0, 0x1f)), 'avc1.42c01f');
    assert.equal(Mp4CodecUtil.parseCodec(createAacInit()), 'mp4a.40.2');
});

test('未知・壊れた init セグメントでは null を返す (CODECS を省ける)', () => {
    assert.equal(Mp4CodecUtil.parseCodec(Buffer.alloc(0)), null);
    assert.equal(Mp4CodecUtil.parseCodec(Buffer.from('not a mp4 box at all')), null);
});

test('マスタープレイリストは音声レンディション 2 本と実データ由来の CODECS を含む', () => {
    const store = createMultiTrackStore(5);

    const master = store.getMasterPlaylist(5, [
        { role: 'a0', name: '主音声', isDefault: true },
        { role: 'a1', name: '副音声', isDefault: false },
    ]);

    assert.ok(master.includes('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="主音声"'));
    assert.ok(master.includes('URI="stream5a0.m3u8"'));
    assert.ok(master.includes('URI="stream5a1.m3u8"'));
    // CODECS が無いと Safari のネイティブ HLS が映像 + 別音声レンディションを再生できない
    assert.ok(master.includes('CODECS="avc1.640028,mp4a.40.2"'), master);
    assert.ok(/#EXT-X-STREAM-INF:BANDWIDTH=[1-9][0-9]*/.test(master), master);
    assert.ok(master.trim().endsWith('stream5v.m3u8'));
});

test('複数音声トラックのレンディションは LL-HLS にしない (PART / PRELOAD-HINT を出さない)', () => {
    const store = createMultiTrackStore(6);

    for (const role of ['v', 'a0', 'a1']) {
        const playlist = store.getPlaylist(6, role);
        assert.ok(playlist.includes('#EXT-X-MAP:URI="stream6' + role + '-init.mp4"'), playlist);
        assert.ok(playlist.includes('stream6' + role + '-0.m4s'), playlist);
        assert.equal(playlist.includes('#EXT-X-PART'), false, playlist);
        assert.equal(playlist.includes('#EXT-X-PRELOAD-HINT'), false, playlist);
        // ライブなので録画済み用の開始位置固定は出さない
        assert.equal(playlist.includes('#EXT-X-START'), false, playlist);
    }
});

test('単一トラック (role 無し) のライブ配信は従来どおり LL-HLS のまま', () => {
    const store = new HLSMemoryStoreModel(logger);
    store.create(7, 'live');
    store.setInit(7, createAvcInit(0x64, 0x00, 0x28));
    pushSegments(store, 7, undefined, 3);

    const playlist = store.getPlaylist(7);
    assert.ok(playlist.includes('#EXT-X-PART:'), playlist);
    assert.ok(playlist.includes('#EXT-X-PRELOAD-HINT'), playlist);
});
