'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isAudioTrackSwitcherVisible } = require('../../dist/util/AudioTrackSwitcherUtil');

test('音声トラック一覧が空から2件へ更新された最終状態では切替 UI を表示する', () => {
    let hidden = !isAudioTrackSwitcherVisible(0);
    assert.equal(hidden, true);

    hidden = !isAudioTrackSwitcherVisible(2);
    assert.equal(hidden, false);
});

test('音声トラックが1件以下なら切替 UI を隠す', () => {
    assert.equal(isAudioTrackSwitcherVisible(0), false);
    assert.equal(isAudioTrackSwitcherVisible(1), false);
    assert.equal(isAudioTrackSwitcherVisible(2), true);
});
