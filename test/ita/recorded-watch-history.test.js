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
    const model = new RecordedApiModel({}, recordedDB, { getRecordedIndex: () => ({}) }, itemUtil, { getConfig: () => ({ featureFlags: { watchHistory: false } }) }, { findByVideoFileIds: async () => { called = true; return []; } });
    await model.gets({ isHalfWidth: false });
    assert.equal(called, false);
});

// 一覧のタイトル表示を「作品名 + 話数」に切り替えられるよう、シリーズ・エピソード情報を
// 1 クエリでまとめて付与する
test('recorded list attaches series info in one bulk lookup', async () => {
    const recordedDB = { findAll: async () => [[{ id: 1 }, { id: 2 }], 2] };
    const itemUtil = { convertRecordedToRecordedItem: r => ({ id: r.id, videoFiles: [] }) };
    let requestedIds = [];
    const seriesDB = {
        findSeriesInfoByRecordedIds: async ids => {
            requestedIds = ids;
            return new Map([
                [
                    1,
                    {
                        seriesId: 7,
                        seriesTitle: '作品名',
                        seasonNumber: 1,
                        episodeNumber: 16,
                        episodeLabel: null,
                        episodeTitle: '猫猫の推理',
                        episodeComment: '定刻放送',
                        episodeCommentSource: 'dictionary',
                        airType: 'first',
                    },
                ],
            ]);
        },
    };
    const config = { getConfig: () => ({ featureFlags: { watchHistory: false, seriesLibrary: true } }) };
    const model = new RecordedApiModel({}, recordedDB, { getRecordedIndex: () => ({}) }, itemUtil, config, {}, seriesDB);
    const result = await model.gets({ isHalfWidth: false });

    assert.deepEqual(requestedIds, [1, 2]);
    assert.equal(result.records[0].series.episodeTitle, '猫猫の推理');
    assert.equal(result.records[0].series.episodeComment, '定刻放送');
    // シリーズに紐づいていない録画には付かない
    assert.equal(typeof result.records[1].series, 'undefined');
});

test('recorded list does not query series info while the feature is off', async () => {
    const recordedDB = { findAll: async () => [[{ id: 1 }], 1] };
    const itemUtil = { convertRecordedToRecordedItem: () => ({ id: 1, videoFiles: [] }) };
    let called = false;
    const seriesDB = { findSeriesInfoByRecordedIds: async () => { called = true; return new Map(); } };
    const config = { getConfig: () => ({ featureFlags: { watchHistory: false, seriesLibrary: false } }) };
    const model = new RecordedApiModel({}, recordedDB, { getRecordedIndex: () => ({}) }, itemUtil, config, {}, seriesDB);
    await model.gets({ isHalfWidth: false });

    assert.equal(called, false);
});

// 放送局名は TS 解析 (SDT) の結果を最優先で表示するため、一覧にまとめて載せる
test('recorded list attaches the channel name read from the TS stream', async () => {
    const recordedDB = { findAll: async () => [[{ id: 1 }, { id: 2 }], 2] };
    const itemUtil = { convertRecordedToRecordedItem: r => ({ id: r.id, videoFiles: [] }) };
    let requestedIds = [];
    const tsInfoDB = {
        findServiceNamesByRecordedIds: async ids => {
            requestedIds = ids;
            return new Map([[1, 'ＮＨＫ総合1・東京']]);
        },
    };
    const config = { getConfig: () => ({ featureFlags: { watchHistory: false, seriesLibrary: false } }) };
    const model = new RecordedApiModel(
        {},
        recordedDB,
        { getRecordedIndex: () => ({}) },
        itemUtil,
        config,
        {},
        {},
        {},
        {},
        tsInfoDB,
    );
    const result = await model.gets({ isHalfWidth: false });

    assert.deepEqual(requestedIds, [1, 2]);
    assert.equal(result.records[0].tsChannelName, 'ＮＨＫ総合1・東京');
    assert.equal(typeof result.records[1].tsChannelName, 'undefined');
});
