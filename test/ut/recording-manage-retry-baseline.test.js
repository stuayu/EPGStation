'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordingManageModel = require('../../dist/model/operator/recording/RecordingManageModel').default;

const system = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} };
const loggerModel = { getLogger: () => ({ system: system, encode: system, stream: system }) };

function createModel(recordedCount) {
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
        { findReserveId: async () => Array.from({ length: recordedCount }, (_, id) => ({ id })) },
        {},
        {},
    );
    return { failedHandler: failedHandler, retryOverCount: () => retryOverCount, timerCount: () => timerCount, model: model };
}

test('現状の挙動 (Phase 4 で変更予定): 関連 Recorded が3件未満なら再設定する', async () => {
    const harness = createModel(2);
    await harness.failedHandler({ id: 41 });
    assert.equal(harness.timerCount(), 1);
    assert.equal(harness.retryOverCount(), 0);
});

test('現状の挙動 (Phase 4 で変更予定): 関連 Recorded が3件以上なら RetryOver を通知する', async () => {
    const harness = createModel(3);
    await harness.failedHandler({ id: 41 });
    assert.equal(harness.timerCount(), 0);
    assert.equal(harness.retryOverCount(), 1);
});
