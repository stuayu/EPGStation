'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DEFAULT_PREP_MS,
    resolveRecordingTimingConfig,
} = require('../../dist/model/operator/recording/RecordingTimingConfig');

// 既存設定の既定値 (config/Configuration.ts の DEFAULT_VALUE と同じ)
const TS_START = 1;
const TS_END = 1;

test('未設定なら EDCB 既定 (張り付き 2 分・マージン 5 秒ずつ)', () => {
    const t = resolveRecordingTimingConfig(undefined, TS_START, TS_END);
    assert.equal(t.prepMs, DEFAULT_PREP_MS);
    assert.equal(DEFAULT_PREP_MS, 2 * 60 * 1000);
    assert.equal(t.startMarginMs, 5000);
    assert.equal(t.endMarginMs, 5000);
});

test('張り付き時間を設定できる', () => {
    const t = resolveRecordingTimingConfig({ prepRecSec: 60 }, TS_START, TS_END);
    assert.equal(t.prepMs, 60 * 1000);
});

test('開始マージン・終了マージンを設定できる', () => {
    const t = resolveRecordingTimingConfig({ startMarginSec: 10, endMarginSec: 30 }, TS_START, TS_END);
    assert.equal(t.startMarginMs, 10 * 1000);
    assert.equal(t.endMarginMs, 30 * 1000);
});

test('マイナスは受け付けず 0 に丸める', () => {
    const t = resolveRecordingTimingConfig(
        { prepRecSec: -30, startMarginSec: -10, endMarginSec: -5 },
        TS_START,
        TS_END,
    );
    // マイナスは 0 になり、既存の時刻指定設定 1 秒が残る
    assert.equal(t.startMarginMs, 1000);
    assert.equal(t.endMarginMs, 1000);
    // prep も 0 に丸めたうえで「開始マージン + 最低リード 5 秒」が下限になる
    assert.equal(t.prepMs, 1000 + 5000);
});

test('マージンを明示的に 0 にすれば 0 にできる', () => {
    const t = resolveRecordingTimingConfig({ startMarginSec: 0, endMarginSec: 0 }, 0, 0);
    assert.equal(t.startMarginMs, 0);
    assert.equal(t.endMarginMs, 0);
});

test('マイナスの時刻指定マージンは 0 として扱い、新設定の既定が残る', () => {
    const t = resolveRecordingTimingConfig({}, -5, -5);
    assert.equal(t.startMarginMs, 5000);
    assert.equal(t.endMarginMs, 5000);
});

test('新設定と既存の時刻指定設定は大きい方を採る', () => {
    const bigNew = resolveRecordingTimingConfig({ startMarginSec: 20, endMarginSec: 40 }, 1, 1);
    assert.equal(bigNew.startMarginMs, 20 * 1000);
    assert.equal(bigNew.endMarginMs, 40 * 1000);

    const bigOld = resolveRecordingTimingConfig({ startMarginSec: 1, endMarginSec: 2 }, 30, 60);
    assert.equal(bigOld.startMarginMs, 30 * 1000);
    assert.equal(bigOld.endMarginMs, 60 * 1000);
});

test('張り付きは必ず開始マージンより前になる', () => {
    // 張り付き 10 秒 < 開始マージン 30 秒 → 張り付きを 35 秒へ押し上げる
    const t = resolveRecordingTimingConfig({ prepRecSec: 10, startMarginSec: 30 }, TS_START, TS_END);
    assert.equal(t.startMarginMs, 30 * 1000);
    assert.equal(t.prepMs, 30 * 1000 + 5 * 1000);
    assert.ok(t.prepMs > t.startMarginMs, '張り付きの方が早い');
});

test('非数・null は既定へ丸める', () => {
    for (const bad of ['x', null, Number.NaN, undefined]) {
        const t = resolveRecordingTimingConfig(
            { prepRecSec: bad, startMarginSec: bad, endMarginSec: bad },
            TS_START,
            TS_END,
        );
        assert.equal(t.prepMs, DEFAULT_PREP_MS);
        assert.equal(t.startMarginMs, 5000);
        assert.equal(t.endMarginMs, 5000);
    }
});

test('極端に大きい値は 6 時間で頭打ちにする', () => {
    const t = resolveRecordingTimingConfig(
        { prepRecSec: 999999, startMarginSec: 999999, endMarginSec: 999999 },
        TS_START,
        TS_END,
    );
    const max = 6 * 60 * 60 * 1000;
    assert.equal(t.startMarginMs, max);
    assert.equal(t.endMarginMs, max);
    assert.equal(t.prepMs, max + 5000);
});

test('recording が null や非オブジェクトでも既定で動く', () => {
    for (const bad of [null, undefined, 42, 'x']) {
        const t = resolveRecordingTimingConfig(bad, TS_START, TS_END);
        assert.equal(t.prepMs, DEFAULT_PREP_MS);
    }
});
