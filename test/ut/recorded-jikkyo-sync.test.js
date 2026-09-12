'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    findRecordedJikkyoCommentIndex,
    resolveRecordedJikkyoPlaybackTime,
    resolveRecordedJikkyoTimestamp,
} = require('../../dist/util/RecordedJikkyoSync');

const START_AT = 1_800_000_000_000;
const comments = [
    { timestamp: START_AT + 1_000, text: 'a' },
    { timestamp: START_AT + 5_000, text: 'b' },
    { timestamp: START_AT + 10_000, text: 'c' },
];

test('録画ファイル先頭時刻とVirtualTimelineの絶対位置から実況時刻を決める', () => {
    assert.equal(resolveRecordedJikkyoTimestamp(START_AT, 5), START_AT + 5_000);
});

test('録画の再生位置へシークしたとき、その位置以降のコメントindexへ貼り替える', () => {
    assert.equal(findRecordedJikkyoCommentIndex(comments, START_AT, 0), 0);
    assert.equal(findRecordedJikkyoCommentIndex(comments, START_AT, 5), 1);
    assert.equal(findRecordedJikkyoCommentIndex(comments, START_AT, 20), comments.length);
});

test('ストリーム再生成中のダミー再生位置は実況同期へ使わない', () => {
    assert.equal(resolveRecordedJikkyoPlaybackTime(80, true), null);
    assert.equal(findRecordedJikkyoCommentIndex(comments, START_AT, null), 0);
    assert.equal(resolveRecordedJikkyoPlaybackTime(Number.NaN, false), null);
});
