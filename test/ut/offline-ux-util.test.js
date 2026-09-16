'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createOfflineProgramInfo,
    createOfflineDataBroadcastingInfo,
    createOfflineDataBroadcastingParam,
    createOfflineVideoKey,
    findOfflineVideoByKey,
    findOfflineVideoByIds,
    getOfflineVideoKey,
    getOfflineOriginalTsKind,
    isOfflineOriginalTsProfile,
    ORIGINAL_MPEG2_CHUNK_SIZE,
    resolveOfflineWatchReturnPath,
    shouldShowOfflineIndicator,
    splitOfflineMpeg2Ranges,
    normalizeOfflineChapters,
} = require('../../dist/util/OfflineUxUtil');
const {
    createOfflinePlaybackPosition,
    createOfflinePlaybackPositionKey,
    getOfflineVideoDurationSeconds,
    normalizeOfflinePlaybackPosition,
    restoreOfflinePlaybackPosition,
} = require('../../dist/util/OfflinePlaybackUtil');

test('MPEG-2 TS を 188 byte 境界のチャンクへ分割する', () => {
    const ranges = splitOfflineMpeg2Ranges(188 * 3 + 10, 188 * 2 + 1);
    assert.deepEqual(ranges, [{ start: 0, end: 375 }, { start: 376, end: 573 }]);
    assert.equal(ORIGINAL_MPEG2_CHUNK_SIZE % 188, 0);
});

test('保存済み videoFileId を一覧から引く', () => {
    const records = [{ videoId: 2 }, { videoId: 7 }];
    assert.deepEqual(findOfflineVideoByIds(records, [7, 9]), { videoId: 7 });
    assert.equal(findOfflineVideoByIds(records, [8]), null);
});

test('保存動画の videoFileId と世代から URL 用の一意キーを作り、解決する', () => {
    const key = createOfflineVideoKey(7, 'generation-1');
    const records = [{ videoId: 7, generationId: 'generation-1' }, { videoId: 7, generationId: 'generation-2' }];
    assert.equal(key, '7-generation-1');
    assert.deepEqual(findOfflineVideoByKey(records, key), records[0]);
    assert.equal(getOfflineVideoKey(records[0]), key);
    assert.equal(createOfflineVideoKey(7, 'bad/key'), '');
});

test('オフライン視聴の戻り先を起点ごとに解決する', () => {
    assert.equal(resolveOfflineWatchReturnPath('list', '12-generation'), '/offline-videos');
    assert.equal(resolveOfflineWatchReturnPath('detail', '12-generation'), '/offline-videos/12-generation');
    assert.equal(resolveOfflineWatchReturnPath('recorded-detail', '12-generation', 34), '/recorded/detail/34');
    assert.equal(resolveOfflineWatchReturnPath('recorded-detail', '12-generation'), '/recorded');
    assert.equal(resolveOfflineWatchReturnPath('unknown', '12-generation'), '/offline-videos');
});

test('オフライン再生位置を正規化して保存・復元する', () => {
    assert.equal(createOfflinePlaybackPositionKey('7-generation-1'), 'epgstation-offline-position:7-generation-1');
    assert.equal(normalizeOfflinePlaybackPosition(-2, 100), 0);
    assert.equal(normalizeOfflinePlaybackPosition(120, 100), 100);
    const stored = createOfflinePlaybackPosition(20, 100, 123);
    assert.deepEqual(stored, { position: 20, duration: 100, updatedAt: 123 });
    assert.equal(restoreOfflinePlaybackPosition(JSON.stringify(stored), 90), 20);
    assert.equal(restoreOfflinePlaybackPosition('{broken', 90), null);
    assert.equal(getOfflineVideoDurationSeconds({ durationSeconds: 12, program: {} }), 12);
    assert.equal(getOfflineVideoDurationSeconds({ program: { startAt: 1000, endAt: 61000 } }), 60);
});

test('起動時または回線断のときだけオフライン表示を出す', () => {
    assert.equal(shouldShowOfflineIndicator(false, false), true);
    assert.equal(shouldShowOfflineIndicator(true, true), true);
    assert.equal(shouldShowOfflineIndicator(true, false), false);
});

test('旧形式スナップショットから不足項目を省略した番組情報を作る', () => {
    const info = createOfflineProgramInfo(
        { channelId: 1, channelName: '局', startAt: Date.UTC(2026, 0, 1, 0), endAt: Date.UTC(2026, 0, 1, 0, 30), name: '番組', description: '概要' },
        { resolveGenre: () => null },
    );
    assert.equal(info.name, '番組');
    assert.equal(info.channelName, '局');
    assert.equal(info.description, '概要');
    assert.equal(info.seriesText, undefined);
    assert.equal(info.genreItems, undefined);
});

test('保存時スナップショットからジャンル、シリーズ、映像音声情報を作る', () => {
    const info = createOfflineProgramInfo(
        {
            channelId: 1,
            startAt: Date.UTC(2026, 0, 1, 0),
            endAt: Date.UTC(2026, 0, 1, 0, 30),
            name: '録画名',
            genre1: 3,
            subGenre1: 0,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            audioSamplingRate: 48000,
            series: { seriesTitle: '作品', episodeLabel: '第1話', episodeTitle: '開始' },
            videoFiles: [{ id: 4, width: 1440, height: 1080, videoCodec: 'mpeg2video', audioCodec: 'aac' }],
        },
        { videoFileId: 4, resolveGenre: genre => `genre-${genre}` },
    );
    assert.deepEqual(info.genreItems, ['genre-3']);
    assert.equal(info.seriesText, '作品 第1話 開始');
    assert.match(info.videoText, /1080i/);
    assert.match(info.audioText, /48000Hz/);
});

test('保存済みチャプターを正規化し、旧形式や不正な項目は空配列にする', () => {
    assert.deepEqual(
        normalizeOfflineChapters([
            { id: 2, startAt: 20, endAt: 30, title: '後半' },
            { id: 1, startAt: 5, endAt: 10, title: null },
            { id: 'bad', startAt: 0, endAt: 1, title: '除外' },
            { id: 3, startAt: 30, endAt: 30, title: '除外' },
        ]),
        [
            { id: 1, startAt: 5, endAt: 10, title: null },
            { id: 2, startAt: 20, endAt: 30, title: '後半' },
        ],
    );
    assert.deepEqual(normalizeOfflineChapters(undefined), []);
});

test('元 TS を保存した MPEG-2 と HEVC のオフラインデータ放送情報を組み立てる', () => {
    const record = {
        videoId: 7,
        kind: 'original-mpeg2',
        originalURL: '/local/original.ts',
        originalFileSize: 188 * 100,
        program: { videoFiles: [{ id: 7, startAt: 123456 }] },
    };
    assert.deepEqual(createOfflineDataBroadcastingInfo(record, true), {
        videoFileId: 7,
        fileSize: 188 * 100,
        chunkSize: 16_777_120,
        url: '/local/original.ts',
        startAt: 123456,
    });
    assert.deepEqual(createOfflineDataBroadcastingInfo({ ...record, kind: 'original-hevc' }), {
        videoFileId: 7,
        fileSize: 188 * 100,
        chunkSize: 16_777_120,
        url: '/local/original.ts',
        startAt: 123456,
    });
    assert.equal(createOfflineDataBroadcastingInfo({ ...record, kind: 'hls' }, true), null);
    assert.equal(createOfflineDataBroadcastingInfo({ ...record, originalFileSize: 0 }, true), null);
});

test('元 TS 保存プロファイルは MPEG-2 と HEVC だけを direct 扱いにする', () => {
    assert.equal(isOfflineOriginalTsProfile('original-mpeg2'), true);
    assert.equal(isOfflineOriginalTsProfile('original-hevc'), true);
    assert.equal(getOfflineOriginalTsKind('original-mpeg2'), 'original-mpeg2');
    assert.equal(getOfflineOriginalTsKind('original-hevc'), 'original-hevc');
    assert.equal(getOfflineOriginalTsKind('original'), null);
    assert.equal(getOfflineOriginalTsKind(undefined), null);
});

test('オフラインデータ放送 decoder の接続パラメータを有効な値だけで組み立てる', () => {
    assert.deepEqual(createOfflineDataBroadcastingParam(7, '/local/original.ts', 188 * 100, 123456, 188 * 10), {
        type: 'offlineOriginal',
        videoFileId: 7,
        url: '/local/original.ts',
        fileSize: 188 * 100,
        chunkSize: 188 * 10,
        startAt: 123456,
    });
    assert.deepEqual(createOfflineDataBroadcastingParam(7, '/local/original.ts', 188 * 100, undefined), {
        type: 'offlineOriginal',
        videoFileId: 7,
        url: '/local/original.ts',
        fileSize: 188 * 100,
        chunkSize: 16_777_120,
        startAt: null,
    });
    assert.equal(createOfflineDataBroadcastingParam(7, '', 188, null), null);
    assert.equal(createOfflineDataBroadcastingParam(7, '/local/original.ts', 0, null), null);
});
