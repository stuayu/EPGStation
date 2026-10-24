'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { countRecordingGaps, deriveRecordingGaps } = require('../../dist/model/operator/recording/RecordingGapUtil');

test('データ未受信で終わった retry attempt は transport gap に数えない', () => {
    const attempts = [
        { firstDataAt: null, endedAt: 10, closeReason: 'error' },
        { firstDataAt: null, endedAt: 20, closeReason: 'error' },
        { firstDataAt: 30, endedAt: 40, closeReason: 'ECONNRESET' },
        { firstDataAt: 50, endedAt: null, closeReason: null },
    ];
    assert.equal(countRecordingGaps(attempts), 1);
    assert.deepEqual(deriveRecordingGaps(attempts), [{ startAt: 40, endAt: 50, reason: 'ECONNRESET' }]);
});

test('最終 attempt と次の first data が無い attempt は gap に含めない', () => {
    assert.equal(countRecordingGaps([{ firstDataAt: 1, endedAt: 2, closeReason: null }]), 0);
    assert.deepEqual(
        deriveRecordingGaps([
            { firstDataAt: null, endedAt: 2, closeReason: 'error' },
            { firstDataAt: null, endedAt: null, closeReason: null },
        ]),
        [],
    );
});

test('データ受信後の attempt と再接続中の未受信 attempt を跨いで gap を復元する', () => {
    const attempts = [
        { firstDataAt: 1, endedAt: 10, closeReason: 'ECONNRESET' },
        { firstDataAt: null, endedAt: 20, closeReason: 'timeout' },
        { firstDataAt: 30, endedAt: null },
    ];
    assert.deepEqual(deriveRecordingGaps(attempts), [{ startAt: 10, endAt: 30, reason: 'ECONNRESET' }]);
});

test('再接続後に一度もデータを受信せず録画が終わった場合も未完了 gap を表示する', () => {
    const attempts = [
        { firstDataAt: 1, endedAt: 10, closeReason: 'upstream-eof' },
        { firstDataAt: null, endedAt: 20, closeReason: 'timeout' },
    ];
    assert.deepEqual(deriveRecordingGaps(attempts), [{ startAt: 10, reason: 'upstream-eof' }]);
    assert.equal(countRecordingGaps(attempts), 0);
});
