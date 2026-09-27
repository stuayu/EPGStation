'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const RecordingSessionTracker = require('../../dist/model/operator/recording/RecordingSessionTracker').default;

const makeTracker = () => {
    const sessions = [];
    const attempts = [];
    const db = {
        createSession: async row => {
            const session = { ...row, id: sessions.length + 1 };
            sessions.push(session);
            return session;
        },
        updateSession: async (id, values) =>
            Object.assign(
                sessions.find(row => row.id === id),
                values,
            ),
        createAttempt: async row => {
            const attempt = { ...row, id: attempts.length + 1 };
            attempts.push(attempt);
            return attempt;
        },
        updateAttempt: async (id, values) =>
            Object.assign(
                attempts.find(row => row.id === id),
                values,
            ),
    };
    const log = { system: { warn() {} } };
    return { tracker: new RecordingSessionTracker(db, log), sessions, attempts };
};

test('session と attempt の状態・終了理由・永続化を管理する', async () => {
    const { tracker, sessions, attempts } = makeTracker();
    await tracker.beginSession({
        id: 5,
        programId: 50,
        channelId: 500,
        startAt: 1000,
        endAt: 2000,
    });
    assert.equal(tracker.session.state, 'PREPARING');
    await tracker.transition('first-data');
    assert.equal(tracker.session.state, 'RECORDING');

    await tracker.beginAttempt(7);
    tracker.currentAttempt.fileOffsetStart = 100;
    tracker.currentAttempt.bytesReceived = 20;
    await tracker.finishAttempt('transport-lost', Object.assign(new Error('reset'), { code: 'ECONNRESET' }));

    assert.equal(tracker.attemptCount, 1);
    assert.equal(attempts[0].priority, 7);
    assert.equal(attempts[0].closeReason, 'transport-lost');
    assert.equal(attempts[0].errorCode, 'ECONNRESET');
    assert.equal(attempts[0].fileOffsetEnd, 120);
    assert.deepEqual(tracker.closeReasons, ['transport-lost']);
    assert.equal(tracker.resolveResult(null, false), 'partial');
    assert.equal(tracker.resolveResult('canceled', true), 'canceled');
    assert.equal(sessions[0].retryCount, 0);

    await tracker.transition('finalize');
    await tracker.transition('finish');
    assert.equal(sessions[0].state, 'FINISHED');
    tracker.closeTelemetrySession('partial', 'transport-lost');
    assert.equal(tracker.telemetrySessionId, null);
});

test('session が無い状態では永続化を行わない', async () => {
    const { tracker } = makeTracker();
    await tracker.persist({ state: 'FINISHED' });
    await tracker.transition('finish');
    await tracker.beginAttempt(1);
    await tracker.finishAttempt('error');
    assert.equal(tracker.session, null);
    assert.equal(tracker.currentAttempt, null);
});
