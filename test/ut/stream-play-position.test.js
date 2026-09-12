'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeStreamPlayPosition } = require('../../dist/util/StreamPlayPosition');

test('直接 URL と録画 HLS 開始 API は同じ再生位置なら同じ ss URL を生成する', () => {
    const createUrl = position => `/api/streams/recorded/31024/m2tsll?mode=0&ss=${normalizeStreamPlayPosition(position)}&audioTrack=all`;
    const directUrl = createUrl(642.2374214183168);
    const hlsApiUrl = createUrl(642);

    assert.equal(directUrl, hlsApiUrl);
    assert.equal(new URL(directUrl, 'http://localhost').searchParams.get('ss'), '642');
});

test('サーバー側の録画ストリーム開始位置は小数を切り捨て、不正値を 0 にする', () => {
    const cases = [
        [642.999, 642],
        ['642.2374214183168', 642],
        [-1.5, 0],
        [Number.NaN, 0],
        [Number.POSITIVE_INFINITY, 0],
        [undefined, 0],
    ];

    for (const [input, expected] of cases) assert.equal(normalizeStreamPlayPosition(input), expected);
});
