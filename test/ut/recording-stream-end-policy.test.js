'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    BACKOFF_MS,
    decideRecordingStreamEnd,
    getRecordingReconnectBackoffMs,
    usesManagedEnd,
} = require('../../dist/model/operator/recording/RecordingStreamEndPolicy');

const base = { closeReason: null, hasError: true, now: 10, deadline: 20, managedEnd: true, isCurrent: true, boundaryDecided: false, reconnectEnabled: true };

test('再接続前に現在性・明示終了・境界・期限を判定する', () => {
    assert.equal(decideRecordingStreamEnd({ ...base, isCurrent: false }), 'ignore');
    assert.equal(decideRecordingStreamEnd({ ...base, closeReason: 'write-error' }), 'ignore');
    assert.equal(decideRecordingStreamEnd({ ...base, closeReason: 'boundary' }), 'boundary');
    assert.equal(decideRecordingStreamEnd({ ...base, boundaryDecided: true }), 'boundary');
    assert.equal(decideRecordingStreamEnd({ ...base, closeReason: 'canceled' }), 'canceled');
    assert.equal(decideRecordingStreamEnd({ ...base, now: 20 }), 'scheduled-end');
});

test('管理終了では EOF と error の両方を再接続し、legacy と無効設定は現状維持', () => {
    assert.equal(decideRecordingStreamEnd({ ...base, hasError: false }), 'reconnect');
    assert.equal(decideRecordingStreamEnd({ ...base, managedEnd: false, hasError: false }), 'stream-ended');
    assert.equal(decideRecordingStreamEnd({ ...base, managedEnd: false }), 'failed');
    assert.equal(decideRecordingStreamEnd({ ...base, reconnectEnabled: false }), 'failed');
    assert.equal(decideRecordingStreamEnd({ ...base, reconnectEnabled: false, hasError: false }), 'stream-ended');
});

test('managedEnd とバックオフの境界を共通化する', () => {
    assert.equal(usesManagedEnd(null, 'program'), true);
    assert.equal(usesManagedEnd(1, 'service'), true);
    assert.equal(usesManagedEnd(1, 'program'), false);
    assert.deepEqual(BACKOFF_MS.map((_, i) => getRecordingReconnectBackoffMs(i)), [500, 1000, 2000, 5000]);
    assert.equal(getRecordingReconnectBackoffMs(99), 5000);
    assert.equal(getRecordingReconnectBackoffMs(-1), 500);
});
