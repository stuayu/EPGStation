'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createThumbnailCandidates } = require('../../dist/model/operator/thumbnail/ThumbnailCandidateGenerator');
const { filterThumbnailCandidatesByChapters, isCommercialChapter } = require('../../dist/model/operator/thumbnail/ThumbnailChapterFilter');
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

test('CMとCM?で始まるチャプターだけをCMとして判定する', () => {
    assert.equal(isCommercialChapter({ title: ' CM ', startAt: 0, endAt: 1 }), true);
    assert.equal(isCommercialChapter({ title: 'cm?', startAt: 0, endAt: 1 }), true);
    assert.equal(isCommercialChapter({ title: 'A', startAt: 0, endAt: 1 }), false);
});

test('CM境界の前後0.5秒にある候補を除外し非CM候補を維持する', () => {
    const candidates = [9.49, 9.5, 15, 20.49, 20.5, 30].map((timestamp, index) => ({ timestamp, index }));
    const result = filterThumbnailCandidatesByChapters(
        candidates,
        [{ id: 1, title: 'CM', startAt: 10, endAt: 20 }],
        60,
        10,
    );
    assert.deepEqual(result.candidates.map(candidate => candidate.timestamp), [9.49, 20.5, 30]);
});

test('全候補がCMなら探索範囲内の非CMチャプター中央で補完する', () => {
    const result = filterThumbnailCandidatesByChapters(
        [{ timestamp: 5, index: 0 }, { timestamp: 15, index: 1 }],
        [
            { id: 1, title: 'CM', startAt: 0, endAt: 20 },
            { id: 2, title: 'A', startAt: 20, endAt: 40 },
            { id: 3, title: 'B', startAt: 100, endAt: 120 },
        ],
        60,
        2,
    );
    assert.deepEqual(result, { candidates: [{ timestamp: 30, index: 0 }], usedFallback: false });
});

test('全チャプターがCMなら元候補へ戻して画像なしを防ぐ', () => {
    const candidates = [{ timestamp: 5, index: 0 }, { timestamp: 15, index: 1 }];
    const result = filterThumbnailCandidatesByChapters(
        candidates,
        [{ id: 1, title: 'CM', startAt: 0, endAt: 20 }],
        60,
        1,
    );
    assert.deepEqual(result, { candidates: [{ timestamp: 5, index: 0 }], usedFallback: true });
});

test('全チャプターが無効なら元候補へ戻す', () => {
    const candidates = [{ timestamp: 5, index: 0 }];
    const result = filterThumbnailCandidatesByChapters(
        candidates,
        [{ id: 1, title: 'A', startAt: 10, endAt: 5 }],
        60,
        1,
    );
    assert.deepEqual(result, { candidates, usedFallback: true });
});

test('基本スコアは画質指標を加点し黒・ぼけを減点する', () => {
    const scorer = new BasicThumbnailScorer();
    assert.equal(scorer.score({ brightness: 30, contrast: 30, sharpness: 20, sceneChange: 20, blackPenalty: 0, blurPenalty: 0 }, {}), 100);
    assert.equal(scorer.score({ brightness: 30, contrast: 30, sharpness: 20, sceneChange: 20, blackPenalty: 10, blurPenalty: 5 }, {}), 85);
});
