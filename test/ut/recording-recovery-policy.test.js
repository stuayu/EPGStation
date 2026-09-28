'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { canResumeRecording, getAlignedRecordingSize } = require('../../dist/model/operator/recording/RecordingRecoveryPolicy');

test('予約・終了期限・録画ファイルがそろう場合だけ再開する', () => {
    const input = { now: 1000, endAt: 2000, endMarginMs: 500, hasReserve: true, fileExists: true };
    assert.equal(canResumeRecording(input), true);
    assert.equal(canResumeRecording({ ...input, hasReserve: false }), false);
    assert.equal(canResumeRecording({ ...input, fileExists: false }), false);
    assert.equal(canResumeRecording({ ...input, now: 2500 }), false);
});

test('TS ファイル末尾を 188 byte 境界にそろえる', () => {
    assert.equal(getAlignedRecordingSize(188 * 20 + 187), 188 * 20);
    assert.equal(getAlignedRecordingSize(187), 0);
    assert.equal(getAlignedRecordingSize(188 * 20), 188 * 20);
});
