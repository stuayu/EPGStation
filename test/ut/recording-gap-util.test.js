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
