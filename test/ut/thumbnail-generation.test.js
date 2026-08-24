'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isThumbnailGenerationCurrent,
    selectThumbnailVideoFile,
    shouldRegenerateThumbnail,
} = require('../../dist/model/operator/thumbnail/ThumbnailManageModel');

test('サムネイル世代はVideoFile ID・サイズ・解析時刻が一致すると現行になる', () => {
    const videoFile = { id: 20, type: 'encoded', size: 1234, analyzedAt: 5000 };
    assert.equal(
        isThumbnailGenerationCurrent({ videoFileId: 20, videoFileSize: 1234, videoFileAnalyzedAt: 5000 }, videoFile),
        true,
    );
    assert.equal(
        isThumbnailGenerationCurrent({ videoFileId: 19, videoFileSize: 1234, videoFileAnalyzedAt: 5000 }, videoFile),
        false,
    );
    assert.equal(
        isThumbnailGenerationCurrent({ videoFileId: 20, videoFileSize: 999, videoFileAnalyzedAt: 5000 }, videoFile),
        false,
    );
    assert.equal(isThumbnailGenerationCurrent(null, videoFile), false);
    assert.equal(
        isThumbnailGenerationCurrent(
            { videoFileId: 20, videoFileSize: null, videoFileAnalyzedAt: 5000 },
            { ...videoFile, size: 0 },
        ),
        false,
    );
});

test('encoded VideoFileを優先し同じ種類では最新IDを選ぶ', () => {
    assert.equal(
        selectThumbnailVideoFile([
            { id: 10, type: 'ts' },
            { id: 11, type: 'encoded' },
            { id: 15, type: 'encoded' },
        ]).id,
        15,
    );
});

test('posterまたはwideの世代情報が欠けていれば再生成対象になる', () => {
    const videoFile = { id: 20, type: 'encoded', size: 1234, analyzedAt: 5000 };
    const current = { videoFileId: 20, videoFileSize: 1234, videoFileAnalyzedAt: 5000 };
    const isCurrent = thumbnail => isThumbnailGenerationCurrent(thumbnail, videoFile);
    assert.equal(isCurrent(current), true);
    assert.equal(isCurrent(null), false);
    assert.equal(isCurrent({ ...current, videoFileId: null }), false);
    assert.equal(shouldRegenerateThumbnail(current, current, videoFile), false);
    assert.equal(shouldRegenerateThumbnail(null, current, videoFile), true);
    assert.equal(shouldRegenerateThumbnail(current, { ...current, videoFileSize: 999 }, videoFile), true);
});
