'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { decideRecordingFinishPolicy, resolveRecordingStatus } = require('../../dist/util/RecordingResult');

test('録画終了理由と空白数から結果を解決する', () => {
    const cases = [
        [{ closeReasons: ['scheduled-end'] }, 'completed'],
        [{ closeReasons: ['transport-lost'] }, 'partial'],
        [{ closeReasons: ['process-restart'] }, 'partial'],
        [{ closeReasons: ['scheduled-end'], transportGapCount: 1 }, 'partial'],
        [{ closeReasons: ['write-error', 'transport-lost'] }, 'failed'],
        [{ closeReasons: ['error'] }, 'failed'],
        [{ closeReasons: ['canceled'] }, 'canceled'],
        [{ closeReasons: ['scheduled-end'], canceled: true }, 'canceled'],
    ];
    for (const [input, expected] of cases) assert.equal(resolveRecordingStatus(input), expected);
});

test('結果別の後処理方針を返す', () => {
    assert.deepEqual(decideRecordingFinishPolicy(null), {
        encode: true,
        removeOriginal: 'configured',
        runFinishCommand: true,
        notification: 'recording.completed',
    });
    assert.deepEqual(decideRecordingFinishPolicy('completed'), decideRecordingFinishPolicy(null));
    assert.deepEqual(decideRecordingFinishPolicy('partial'), {
        encode: true,
        removeOriginal: 'never',
        runFinishCommand: true,
        notification: 'recording.partial',
    });
    assert.equal(decideRecordingFinishPolicy('failed').encode, false);
    assert.equal(decideRecordingFinishPolicy('failed').runFinishCommand, false);
    assert.deepEqual(decideRecordingFinishPolicy('canceled'), decideRecordingFinishPolicy('completed'));
});
