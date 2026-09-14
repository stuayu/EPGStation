'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createOfflineProgramInfo,
    findOfflineVideoByIds,
    ORIGINAL_MPEG2_CHUNK_SIZE,
    shouldShowOfflineIndicator,
    splitOfflineMpeg2Ranges,
} = require('../../dist/util/OfflineUxUtil');

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
