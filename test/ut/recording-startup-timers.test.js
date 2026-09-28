'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordingManageModel = require('../../dist/model/operator/recording/RecordingManageModel').default;

const log = { system: { info() {}, warn() {}, error() {}, debug() {}, fatal() {} } };

test('起動時に未登録の有効予約すべてへタイマーを張り、期限切れと再開済みを除外する', async () => {
    const now = Date.now();
    const reserves = [
        { id: 1, startAt: now + 60_000, endAt: now + 120_000, isTimeSpecified: true, isSkip: false, isOverlap: false },
        { id: 2, startAt: now + 60_000, endAt: now + 120_000, programId: 22, isSkip: false, isOverlap: false },
        { id: 3, startAt: now + 60_000, endAt: now + 120_000, ruleId: 33, isSkip: false, isOverlap: false },
        { id: 4, startAt: now - 120_000, endAt: now - 60_000, isSkip: false, isOverlap: false },
        { id: 5, startAt: now - 60_000, endAt: now + 60_000, isConflict: true, isSkip: false, isOverlap: false },
        { id: 6, startAt: now + 60_000, endAt: now + 120_000, isSkip: true, isOverlap: false },
        { id: 7, startAt: now + 60_000, endAt: now + 120_000, isSkip: false, isOverlap: true },
    ];
    const timerCalls = [];
    const model = Object.create(RecordingManageModel.prototype);
    model.log = log;
    model.recordingIndex = { 2: { resumed: true } };
    model.reserveDB = {
        findLists: async () => reserves,
    };
    model.provider = async () => ({
        setTimer: reserve => {
            timerCalls.push(reserve.id);
            return true;
        },
    });

    await model.setupStartupTimers();

    assert.deepEqual(timerCalls, [1, 3, 5]);
    assert.deepEqual(Object.keys(model.recordingIndex).map(Number).sort(), [1, 2, 3, 5]);
});
