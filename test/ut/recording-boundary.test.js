'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { decideRecordingEnd } = require('../../dist/model/operator/recording/RecordingBoundary');

const NOW = Date.parse('2026-08-19T12:00:00+09:00');

test('対象 present 確認後に別 event へ変化したら終了する', () => {
    assert.equal(
        decideRecordingEnd({
            targetEventId: 100,
            presentEventId: 101,
            targetConfirmed: true,
            now: NOW,
            endAt: NOW + 60_000,
            endMarginMs: 1_000,
        }),
        'present-event-changed',
    );
});

test('開始後の EIT 欠落では終了しない', () => {
    assert.equal(
        decideRecordingEnd({
            targetEventId: 100,
            presentEventId: null,
            targetConfirmed: true,
            now: NOW,
            endAt: NOW + 60_000,
            endMarginMs: 1_000,
        }),
        null,
    );
});

test('target event 未確認の別 event は予定終了まで終了しない', () => {
    assert.equal(
        decideRecordingEnd({
            targetEventId: 100,
            presentEventId: 101,
            targetConfirmed: false,
            now: NOW,
            endAt: NOW + 60_000,
            endMarginMs: 1_000,
        }),
        null,
    );
});

test('予定終了 + margin は EIT が無くても hard 終了する', () => {
    assert.equal(
        decideRecordingEnd({
            targetEventId: 100,
            presentEventId: null,
            targetConfirmed: false,
            now: NOW + 61_000,
            endAt: NOW + 60_000,
            endMarginMs: 1_000,
        }),
        'scheduled-end',
    );
});
