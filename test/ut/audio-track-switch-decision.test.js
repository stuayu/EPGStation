'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { decideAudioTrackSwitch, decideOfflineAudioTrackSwitch } = require('../../dist/util/AudioTrackSwitchDecision');

test('同じ音声トラックを選んだ場合は何もしない', () => {
    assert.equal(decideAudioTrackSwitch('sub', 'sub', false), 'noop');
    assert.equal(decideAudioTrackSwitch('main', 'main', true), 'noop');
});

test('同時配信可能な音声トラックは再接続せず切り替える', () => {
    assert.equal(decideAudioTrackSwitch('main', 'sub', true), 'embedded');
});

test('同時配信できない音声トラックは再接続する', () => {
    assert.equal(decideAudioTrackSwitch('main', 'sub', false), 'reconnect');
});

test('オフラインのデュアルモノラルは読み直さず、独立音声 ES は読み直す', () => {
    assert.equal(decideOfflineAudioTrackSwitch('main', 'sub', true), 'dual-mono');
    assert.equal(decideOfflineAudioTrackSwitch('main', 'sub', false), 'reload');
    assert.equal(decideOfflineAudioTrackSwitch('sub', 'sub', false), 'noop');
});
