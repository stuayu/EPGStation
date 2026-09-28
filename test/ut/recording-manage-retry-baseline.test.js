'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordingManageModel = require('../../dist/model/operator/recording/RecordingManageModel').default;

const system = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} };
const loggerModel = { getLogger: () => ({ system: system, encode: system, stream: system }) };

function createModel() {
    let failedHandler;
    let retryOverCount = 0;
    let timerCount = 0;
    const recordingEvent = {
        setCancelPrepRecording: () => {},
        setPrepRecordingFailed: () => {},
        setRecordingFailed: handler => { failedHandler = handler; },
        setFinishRecording: () => {},
        emitRecordingRetryOver: () => { retryOverCount++; },
    };
    const model = new RecordingManageModel(
        loggerModel,
        { getConfig: () => ({}) },
        async () => ({ setTimer: () => { timerCount++; return true; } }),
        recordingEvent,
        {},
        { findReserveId: async () => [] },
        {},
        {},
    );
    return { failedHandler: failedHandler, retryOverCount: () => retryOverCount, timerCount: () => timerCount, model: model };
}

test('予約ごとに2回まで再設定し、3回目の失敗で RetryOver を通知する', async () => {
    const harness = createModel();
    await harness.failedHandler({ id: 41 });
    await harness.failedHandler({ id: 41 });
    assert.equal(harness.timerCount(), 2);
    assert.equal(harness.retryOverCount(), 0);
    await harness.failedHandler({ id: 41 });
    assert.equal(harness.timerCount(), 2);
    assert.equal(harness.retryOverCount(), 1);
});
