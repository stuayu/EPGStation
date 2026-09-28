'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordingManageModel = require('../../dist/model/operator/recording/RecordingManageModel').default;

const silent = { info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, debug: () => {} };

test('孤立セッション掃除は設定日数を使い、省略時は90日を使う', async () => {
    const cutoffs = [];
    const model = Object.create(RecordingManageModel.prototype);
    model.log = { system: silent };
    model.config = { recording: { resultRetentionDays: 12 }, recorded: [] };
    model.recordingSessionDB = {
        deleteOrphanSessionsBefore: async cutoff => cutoffs.push(cutoff),
        findByState: async () => [],
    };
    model.recordedDB = { findAll: async () => [[], 0] };
    model.reserveDB = {};
    const before = Date.now();
    await model.cleanup();
    assert.ok(cutoffs[0] >= before - 12 * 86400000 - 100);
    assert.ok(cutoffs[0] <= before - 12 * 86400000 + 100);

    model.config.recording = undefined;
    const defaultBefore = Date.now();
    await model.cleanup();
    assert.ok(cutoffs[1] >= defaultBefore - 90 * 86400000 - 100);
    assert.ok(cutoffs[1] <= defaultBefore - 90 * 86400000 + 100);

    model.config.recording = { resultRetentionDays: 0 };
    await model.cleanup();
    assert.equal(cutoffs.length, 2, '0 以下なら削除しない');
});
