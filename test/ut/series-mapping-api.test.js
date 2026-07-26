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
    };
    return {
        model: new Model(
            { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) },
            { findId: async () => recorded },
            db,
        ),
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
