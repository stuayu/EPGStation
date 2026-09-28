'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { MirakurunRecordingStub, status } = require('../support/MirakurunRecordingStub');
const { RecorderHarness } = require('../support/RecorderHarness');
const EventSetter = require('../../dist/model/event/EventSetter').default;
const RecordingSessionApiModel = require('../../dist/model/api/recorded/RecordingSessionApiModel').default;
const recordingResultsRoute = require('../../dist/model/service/api/recording-results').get;
const container = require('../../dist/model/ModelContainer').default;

test('503 で開始前リトライを使い切ると API に failed が残り通知は 1 回届く', async t => {
    const stub = new MirakurunRecordingStub([status(503), status(503)]);
    const harness = new RecorderHarness(stub, {
        recording: {
            errorFastRetryCount: 1,
            errorRetryCount: 1,
            errorFastRetryIntervalMs: 10,
            errorRetryIntervalMs: 10,
        },
    });
    await harness.start();
    t.after(() => harness.cleanup());

    harness.recorder.channelDB.findId = async id => ({ id, name: 'テスト局' });
    const notices = [];
    let prepFailedHandler;
    const eventStub = new Proxy(
        {},
        {
            get: (_target, key) =>
                key === 'setPrepRecordingFailed'
                    ? callback => {
                          prepFailedHandler = callback;
                      }
                    : () => {},
        },
    );
    const noops = new Proxy({}, { get: () => () => {} });
    const logger = { system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} } };
    const setter = new EventSetter(
        { getLogger: () => logger },
        noops,
        noops,
        noops,
        noops,
        eventStub,
        noops,
        noops,
        noops,
        { cancel() {} },
        {},
        {},
        {},
        { add() {} },
        { addRecordingPrepRecFailedCmd() {} },
        { notifyClient() {} },
        { getConfig: () => ({ recorded: [] }) },
        { dispatch: async (type, payload) => notices.push({ type, payload }) },
        {},
        {},
        {},
        {},
        { onChange() {} },
        { findId: async id => ({ id, name: 'テスト局' }) },
    );
    setter.set();
    harness.recorder.recordingEvent.emitPrepRecordingFailed = (...args) => {
        void prepFailedHandler(...args);
    };

    const reserve = createReserve();
    harness.recorder.setTimer(reserve, true);
    await waitFor(() => notices.length === 1);

    const apiModel = new RecordingSessionApiModel({
        findRecordingResults: async query => {
            const items = harness.recordingSessions
                .filter(session => session.resultStatus === query.result)
                .sort((a, b) => b.scheduledStartAt - a.scheduledStartAt)
                .slice(query.offset, query.offset + query.limit);
            return { items, total: items.length };
        },
    });
    if (container.isBound('IRecordingSessionApiModel')) {
        await container.unbind('IRecordingSessionApiModel');
    }
    container.bind('IRecordingSessionApiModel').toConstantValue(apiModel);
    const app = express();
    app.get('/api/recording-results', recordingResultsRoute);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await container.unbind('IRecordingSessionApiModel');
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/recording-results?result=failed`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(stub.requests.filter(request => request.url.includes('/stream')).length, 3);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].resultStatus, 'failed');
    assert.equal(result.items[0].name, '録画失敗テスト');
    assert.equal(result.items[0].channelName, 'テスト局');
    assert.equal(result.items[0].retryCount, 2);
    assert.equal(notices.length, 1);
    assert.deepEqual(notices[0], {
        type: 'recording.startFailed',
        payload: {
            name: '録画失敗テスト',
            channelName: 'テスト局',
            startAt: reserve.startAt,
            endReason: 'error',
            retryCount: 2,
            reserveId: reserve.id,
            ruleId: reserve.ruleId,
        },
    });
});

function createReserve() {
    const now = Date.now() - 10_000;
    return {
        id: 99301,
        programId: null,
        channelId: 12345,
        channelType: 'GR',
        channel: 'テスト局',
        startAt: now,
        endAt: now + 60_000,
        isTimeSpecified: false,
        isConflict: false,
        isFollowingSchedule: false,
        isEventRelay: false,
        allowEndLack: false,
        isSkip: false,
        isOverlap: false,
        ruleId: 9,
        name: '録画失敗テスト',
        halfWidthName: '録画失敗テスト',
    };
}

async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for start failure notification');
}
