'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isThumbnailGenerationCurrent,
} = require('../../dist/model/operator/thumbnail/ThumbnailManageModel');

test('サムネイル世代はVideoFile ID・サイズ・解析時刻が一致すると現行になる', () => {
    const videoFile = { id: 20, type: 'encoded', size: 1234, analyzedAt: 5000 };
    assert.equal(isThumbnailGenerationCurrent({ videoFileId: 20, videoFileSize: 1234, videoFileAnalyzedAt: 5000 }, videoFile), true);
    assert.equal(isThumbnailGenerationCurrent({ videoFileId: 19, videoFileSize: 1234, videoFileAnalyzedAt: 5000 }, videoFile), false);
    assert.equal(isThumbnailGenerationCurrent({ videoFileId: 20, videoFileSize: 999, videoFileAnalyzedAt: 5000 }, videoFile), false);
    assert.equal(isThumbnailGenerationCurrent(null, videoFile), false);
});
