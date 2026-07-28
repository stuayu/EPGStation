'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/api/series/SeriesMappingApiModel').default;
function fixture() {
    let link = null;
    const series = { id: 2, title: '作品', normalizedTitle: '作品' };
    const recorded = { id: 1, name: '作品 第2話', channelId: 10, startAt: 100 };
    const episode = { id: 3, seriesId: 2, seasonNumber: 1, episodeNumber: 2 };
    const db = {
        findLink: async () => link,
        getSeries: async id => (id === 2 ? series : null),
        findEpisodeById: async () => episode,
        findEpisode: async () => episode,
        createEpisode: async () => episode,
        createSeries: async v => ({ ...v, id: 2 }),
        saveLink: async v => (link = { ...v, id: 4 }),
        deleteLink: async () => {
            link = null;
        },
        addHistory: async v => ({ ...v, id: 5, undone: false }),
        deletePendingMatchByRecordedId: async () => {},
        upsertAlias: async (normalizedTitle, seriesId, createdAt) => ({ id: 6, normalizedTitle, seriesId, createdAt }),
        getLatestHistoryForRecorded: async () => null,
        markHistoryUndone: async () => {},
    };
    const resolver = { resolve: async () => null };
    return {
        model: new Model(
            { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) },
            { findId: async () => recorded },
            db,
            resolver,
        ),
        db,
    };
}
test('manual mapping locks selection with full confidence', async () => {
    const { model } = fixture();
    const x = await model.update(1, { seriesId: 2, seasonNumber: 1, episodeNumber: 2, airType: 'rerun' });
    assert.equal(x.manualLock, true);
    assert.equal(x.matchMethod, 'manual');
    assert.equal(x.confidence, 1);
    assert.equal(x.airType, 'rerun');
});
test('manual mapping can create a new series and can be removed', async () => {
    const { model } = fixture();
    const x = await model.update(1, { seriesTitle: '新作品', seasonNumber: 1, episodeNumber: null });
    assert.equal(x.seriesId, 2);
    await model.remove(1);
    assert.equal(await model.get(1), null);
});
test('manual mapping validates episode values', async () => {
    const { model } = fixture();
    await assert.rejects(
        () => model.update(1, { seriesId: 2, seasonNumber: 0, episodeNumber: -1 }),
        /InvalidseasonNumber/,
    );
});
test('undo restores the link to its pre-change state', async () => {
    const { model, db } = fixture();
    await model.update(1, { seriesId: 2, seasonNumber: 1, episodeNumber: 2, airType: 'rerun' });
    // 割当前は未割当だったので、履歴の previousSeriesId は null
    db.getLatestHistoryForRecorded = async () => ({
        id: 9,
        recordedId: 1,
        previousSeriesId: null,
        previousEpisodeId: null,
        previousAirType: null,
        previousMatchMethod: null,
        previousConfidence: null,
        previousManualLock: null,
    });
    let undone = false;
    db.markHistoryUndone = async () => {
        undone = true;
    };
    const result = await model.undo(1);
    assert.equal(undone, true);
    assert.equal(result, null);
});
test('undo throws when there is no history to restore', async () => {
    const { model } = fixture();
    await assert.rejects(() => model.undo(1), /SeriesChangeHistoryIsNotFound/);
});

/**
 * 一括更新は「既存のシリーズ割当を引き継ぎ、指定した項目だけ差し替える」ことを保証する
 */
function bulkFixture() {
    const series = { id: 2, title: '作品', normalizedTitle: '作品' };
    const links = {
        11: { id: 1, recordedId: 11, seriesId: 2, episodeId: 31, airType: 'first', channelId: 10 },
        12: { id: 2, recordedId: 12, seriesId: 2, episodeId: null, airType: 'unknown', channelId: 10 },
    };
    const episodes = { 31: { id: 31, seriesId: 2, seasonNumber: 1, episodeNumber: 5 } };
    const saved = [];
    const aliases = [];
    const db = {
        findLink: async recordedId => links[recordedId] ?? null,
        getSeries: async id => (id === 2 ? series : null),
        findEpisodeById: async id => episodes[id] ?? null,
        findEpisode: async (seriesId, seasonNumber, episodeNumber) => ({
            id: 100 + episodeNumber,
            seriesId,
            seasonNumber,
            episodeNumber,
        }),
        createEpisode: async v => ({ ...v, id: 200 }),
        saveLink: async v => {
            saved.push(v);
            links[v.recordedId] = { ...links[v.recordedId], ...v };
            return links[v.recordedId];
        },
        addHistory: async () => {},
        deletePendingMatchByRecordedId: async () => {},
        upsertAlias: async normalizedTitle => aliases.push(normalizedTitle),
    };
    return {
        model: new Model(
            { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) },
            { findId: async id => ({ id, name: `作品 第${id}話`, channelId: 10, startAt: 100 }) },
            db,
            { resolve: async () => null },
        ),
        saved,
        aliases,
    };
}
test('bulk update assigns episode numbers and keeps the existing series', async () => {
    const { model, saved } = bulkFixture();
    const result = await model.updateBulk({
        items: [
            { recordedId: 11, episodeNumber: 1 },
            { recordedId: 12, episodeNumber: 2 },
        ],
    });
    assert.equal(result.updated, 2);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(
        saved.map(x => x.seriesId),
        [2, 2],
    );
    assert.equal(saved[0].matchMethod, 'manual');
    assert.equal(saved[0].manualLock, true);
});
test('bulk update keeps unspecified values (air type only edit does not clear the episode)', async () => {
    const { model, saved } = bulkFixture();
    const result = await model.updateBulk({ items: [{ recordedId: 11, airType: 'delayed' }] });
    assert.equal(result.updated, 1);
    assert.equal(saved[0].airType, 'delayed');
    // episodeNumber を指定していないので既存の 第5話 (episodeId 105) が維持される
    assert.equal(saved[0].episodeId, 105);
});
test('bulk update does not learn aliases unless asked', async () => {
    const { model, aliases } = bulkFixture();
    await model.updateBulk({ items: [{ recordedId: 11, episodeNumber: 1 }] });
    assert.equal(aliases.length, 0);
    await model.updateBulk({ items: [{ recordedId: 11, episodeNumber: 2 }], learnAlias: true });
    assert.equal(aliases.length, 1);
});
test('bulk update reports per-record failures without aborting the rest', async () => {
    const { model } = bulkFixture();
    const result = await model.updateBulk({
        items: [{ recordedId: 999 }, { recordedId: 11, episodeNumber: 3 }],
    });
    assert.equal(result.updated, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].recordedId, 999);
    assert.match(result.failed[0].message, /SeriesMappingIsNotFound/);
});
test('bulk update rejects an invalid body', async () => {
    const { model } = bulkFixture();
    await assert.rejects(() => model.updateBulk({}), /InvalidRequestBody/);
});
