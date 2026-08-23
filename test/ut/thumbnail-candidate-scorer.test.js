'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createThumbnailCandidates } = require('../../dist/model/operator/thumbnail/ThumbnailCandidateGenerator');
const BasicThumbnailScorer = require('../../dist/model/operator/thumbnail/ThumbnailScorer').default;

test('サムネイル候補は録画の5%から95%まで均等生成される', () => {
    const candidates = createThumbnailCandidates(1800, 20, 5);
    assert.equal(candidates.length, 20);
    assert.equal(candidates[0].timestamp, 90);
    assert.equal(candidates.at(-1).timestamp, 1710);
});

test('不正な録画長は既存の切り出し位置へフォールバックする', () => {
    assert.deepEqual(createThumbnailCandidates(0, 20, 5), [{ timestamp: 5, index: 0 }]);
});

test('短時間動画は実時間を超えない中央候補1点になる', () => {
    const candidates = createThumbnailCandidates(5, 20, 10);
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0].timestamp < 5);
});

test('基本スコアは画質指標を加点し黒・ぼけを減点する', () => {
    const scorer = new BasicThumbnailScorer();
    assert.equal(scorer.score({ brightness: 30, contrast: 30, sharpness: 20, sceneChange: 20, blackPenalty: 0, blurPenalty: 0 }, {}), 100);
    assert.equal(scorer.score({ brightness: 30, contrast: 30, sharpness: 20, sceneChange: 20, blackPenalty: 10, blurPenalty: 5 }, {}), 85);
});
