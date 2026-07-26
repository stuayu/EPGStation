'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordedApiModel = require('../../dist/model/api/recorded/RecordedApiModel').default;

test('recorded list attaches watch history in one bulk lookup', async () => {
    const records = [{ id: 1 }];
    const recordedDB = { findAll: async () => [records, 1] };
    const encode = { getRecordedIndex: () => ({}) };
    const itemUtil = { convertRecordedToRecordedItem: () => ({ id: 1, videoFiles: [{ id: 10, name: 'main', filename: 'x.ts', type: 'ts', size: 1 }] }) };
    let requestedIds = [];
    const watchDB = { findByVideoFileIds: async ids => {
        requestedIds = ids;
        return [{ videoFileId: 10, recordedId: 1, position: 50, duration: 100, status: 'watching', updatedAt: 123 }];
    } };
    const config = { getConfig: () => ({ featureFlags: { watchHistory: true } }) };
    const model = new RecordedApiModel({}, recordedDB, encode, itemUtil, config, watchDB);
    const result = await model.gets({ isHalfWidth: false });
    assert.deepEqual(requestedIds, [10]);
    assert.equal(result.records[0].videoFiles[0].watchHistory.status, 'watching');
    assert.equal(result.records[0].videoFiles[0].watchHistory.position, 50);
});

test('recorded list does not query watch history while feature is off', async () => {
    const recordedDB = { findAll: async () => [[{ id: 1 }], 1] };
    const itemUtil = { convertRecordedToRecordedItem: () => ({ id: 1, videoFiles: [{ id: 10 }] }) };
    let called = false;
    const model = new RecordedApiModel({}, recordedDB, { getRecordedIndex: () => ({}) }, itemUtil, { getConfig: () => ({ featureFlags: {} }) }, { findByVideoFileIds: async () => { called = true; return []; } });
    await model.gets({ isHalfWidth: false });
    assert.equal(called, false);
});
