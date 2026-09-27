'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    RecordingSessionEvent: E,
    transitionRecordingSession,
} = require('../../dist/model/operator/recording/RecordingSessionState');

test('録画セッションの全ての許可遷移が定義されている', () => {
    const transitions = [
        ['SCHEDULED', E.PREPARE, 'PREPARING'],
        ['SCHEDULED', E.CANCEL, 'FINALIZING'],
        ['PREPARING', E.WAIT_BOUNDARY, 'WAITING_BOUNDARY'],
        ['PREPARING', E.FIRST_DATA, 'RECORDING'],
        ['PREPARING', E.FAIL, 'FINALIZING'],
        ['PREPARING', E.CANCEL, 'FINALIZING'],
        ['WAITING_BOUNDARY', E.FIRST_DATA, 'RECORDING'],
        ['WAITING_BOUNDARY', E.FAIL, 'FINALIZING'],
        ['WAITING_BOUNDARY', E.CANCEL, 'FINALIZING'],
        ['RECORDING', E.RECONNECT, 'RECONNECTING'],
        ['RECORDING', E.FINALIZE, 'FINALIZING'],
        ['RECORDING', E.FAIL, 'FINALIZING'],
        ['RECORDING', E.CANCEL, 'FINALIZING'],
        ['RECONNECTING', E.RECONNECTED, 'RECORDING'],
        ['RECONNECTING', E.RECONNECT, 'RECONNECTING'],
        ['RECONNECTING', E.FINALIZE, 'FINALIZING'],
        ['RECONNECTING', E.FAIL, 'FINALIZING'],
        ['RECONNECTING', E.CANCEL, 'FINALIZING'],
        ['FINALIZING', E.FINISH, 'FINISHED'],
    ];
    for (const [from, event, to] of transitions) {
        assert.deepEqual(transitionRecordingSession(from, event), { state: to });
    }
});

test('不許可遷移は状態を維持し警告を返す', () => {
    assert.deepEqual(transitionRecordingSession('FINISHED', E.PREPARE), {
        state: 'FINISHED',
        warning: 'Ignoring invalid recording session transition: FINISHED + prepare',
    });
});
