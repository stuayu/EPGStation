'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Analyzer = require('../../dist/model/operator/thumbnail/ThumbnailImageAnalyzer').default;
const Scorer = require('../../dist/model/operator/thumbnail/ThumbnailScorer').default;

const image = (width, height, fn) => {
    const data = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        const value = fn(i % width, Math.floor(i / width));
        data[i * 3] = value[0]; data[i * 3 + 1] = value[1]; data[i * 3 + 2] = value[2];
    }
    return data;
};

test('黒画像は brightness が低く blackRatio が高い', () => {
    const features = new Analyzer().analyze(image(8, 8, () => [0, 0, 0]), 8, 8);
    assert.equal(features.brightness, 0);
    assert.equal(features.blackRatio, 1);
});

test('白画像は白飛びとして明るさ255になる', () => {
    const features = new Analyzer().analyze(image(8, 8, () => [255, 255, 255]), 8, 8);
    assert.equal(features.brightness, 255);
    assert.equal(features.blackRatio, 0);
});

test('明瞭な高コントラスト画像は単色画像より高スコア', () => {
    const analyzer = new Analyzer();
    const scorer = new Scorer();
    const flat = analyzer.analyze(image(16, 16, () => [100, 100, 100]), 16, 16);
    const sharp = analyzer.analyze(image(16, 16, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0] : [255, 255, 255])), 16, 16);
    const score = f => scorer.score({ brightness: f.brightness, contrast: f.contrast, sharpness: f.sharpness, sceneChange: f.edge, blackPenalty: f.blackRatio * 50, blurPenalty: 0, features: f }, {});
    assert.ok(score(sharp) > score(flat));
});
