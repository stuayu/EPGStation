'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const PendingModel = require('../../dist/model/api/series/SeriesPendingApiModel').default;
const MaintenanceModel = require('../../dist/model/api/series/SeriesMaintenanceApiModel').default;
const AliasModel = require('../../dist/model/api/series/SeriesAliasApiModel').default;
const config = { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) };
const disabledConfig = { getConfig: () => ({ featureFlags: {} }) };

function pendingFixture() {
    const recorded = { id: 7, name: '作品 第1話', channelId: 10, startAt: 100 };
    const pending = {
        id: 1,
        recordedId: 7,
        normalizedTitle: '作品',
        channelId: 10,
        candidatesJson: JSON.stringify([{ seriesId: 2, seriesTitle: '作品', score: 0.5 }]),
        createdAt: 123,
    };
    const seriesDB = {
        listPendingMatches: async () => [[pending], 1],
        getPendingMatch: async id => (id === 1 ? pending : null),
        deletePendingMatch: async () => {},
    };
    const mappingApiModel = {
        update: async (recordedId, option) => ({ recordedId, seriesId: option.seriesId, manualLock: true }),
    };
    return {
        model: new PendingModel(config, { findId: async () => recorded }, seriesDB, mappingApiModel),
    };
}

test('pending queue lists items with recorded title and parsed candidates', async () => {
    const { model } = pendingFixture();
    const result = await model.list(0, 30);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].recordedTitle, '作品 第1話');
    assert.equal(result.items[0].candidates[0].seriesId, 2);
});
test('pending confirm delegates to mapping update using the pending recordedId', async () => {
    const { model } = pendingFixture();
    const result = await model.confirm(1, { seriesId: 2 });
    assert.equal(result.recordedId, 7);
    assert.equal(result.seriesId, 2);
});
test('pending confirm throws when the pending row is gone', async () => {
    const { model } = pendingFixture();
    await assert.rejects(() => model.confirm(999, {}), /PendingMatchIsNotFound/);
});
test('pending queue is hidden while feature is disabled', async () => {
    const model = new PendingModel(disabledConfig, {}, {}, {});
    await assert.rejects(() => model.list(0, 10), /SeriesLibraryFeatureIsDisabled/);
});

function maintenanceFixture() {
    const seriesA = { id: 1, title: 'A' };
    const seriesB = { id: 2, title: 'B' };
    const db = {
        getSeries: async id => ({ 1: seriesA, 2: seriesB }[id] ?? null),
        mergeSeries: async () => 3,
        splitSeries: async (sourceId, recordedIds, newTitle) => ({ id: 9, title: newTitle }),
    };
    return { model: new MaintenanceModel(config, db) };
}
test('merge moves links from source to target series', async () => {
    const { model } = maintenanceFixture();
    const result = await model.merge(1, 2);
    assert.equal(result.movedLinkCount, 3);
});
test('merge rejects merging a series into itself', async () => {
    const { model } = maintenanceFixture();
    await assert.rejects(() => model.merge(1, 1), /InvalidRequestBody/);
});
test('merge rejects unknown series ids', async () => {
    const { model } = maintenanceFixture();
    await assert.rejects(() => model.merge(1, 999), /SeriesIsNotFound/);
});
test('split creates a new series from the given recordings', async () => {
    const { model } = maintenanceFixture();
    const result = await model.split(1, [10, 11], '新シリーズ');
    assert.equal(result.seriesId, 9);
    assert.equal(result.title, '新シリーズ');
});
test('split rejects an empty recordedIds list', async () => {
    const { model } = maintenanceFixture();
    await assert.rejects(() => model.split(1, [], '新シリーズ'), /InvalidRequestBody/);
});

test('alias list enriches entries with series title and can be removed', async () => {
    const db = {
        listAlias: async () => [{ id: 1, normalizedTitle: '作品', seriesId: 2, createdAt: 1 }],
        getSeries: async id => (id === 2 ? { id: 2, title: '作品名' } : null),
        deleteAlias: async () => {},
    };
    const model = new AliasModel(config, db);
    const items = await model.list();
    assert.equal(items[0].seriesTitle, '作品名');
    await model.remove(1);
});
