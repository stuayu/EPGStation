'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    getDPlayerAudioValue,
    selectAudioTrackIndex,
} = require('../../dist/util/DPlayerAudioTrackUtil');

const tracks = [{ track: 'main' }, { track: 'sub' }];

test('現在の音声トラックが一覧にあればその添字を返す', () => {
    assert.equal(selectAudioTrackIndex(tracks, 'sub'), 1);
});

test('現在の音声トラックが一覧に無ければ先頭を選ぶ', () => {
    assert.equal(selectAudioTrackIndex(tracks, 'missing'), 0);
});

test('音声トラック一覧が空なら選択添字を持たない', () => {
    assert.equal(selectAudioTrackIndex([], 'main'), -1);
});

test('DPlayerの音声指定子を主音声・副音声へ変換する', () => {
    assert.equal(getDPlayerAudioValue('main'), 'primary');
    assert.equal(getDPlayerAudioValue('0'), 'primary');
    assert.equal(getDPlayerAudioValue('sub'), 'secondary');
    assert.equal(getDPlayerAudioValue('1'), 'secondary');
});
