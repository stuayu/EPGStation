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
