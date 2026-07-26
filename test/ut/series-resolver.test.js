'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesResolver = require('../../dist/model/series/SeriesResolver').default;
const { titleSimilarity } = require('../../dist/model/series/SeriesResolver');
function memory(candidates = []) {
    let nextSeries = 20,
        nextEpisode = 30;
    const links = new Map(),
        episodes = [];
    return {
        links,
        episodes,
        findCandidates: async () => candidates,
        createSeries: async v => ({ ...v, id: nextSeries++ }),
        findEpisode: async (s, se, e) =>
            episodes.find(x => x.seriesId === s && x.seasonNumber === se && x.episodeNumber === e) || null,
        createEpisode: async v => {
            const x = { ...v, id: nextEpisode++ };
            episodes.push(x);
            return x;
        },
        findLink: async id => links.get(id) || null,
        countOtherLinksByEpisode: async (episodeId, recordedId) =>
            [...links.values()].filter(x => x.episodeId === episodeId && x.recordedId !== recordedId).length,
        saveLink: async v => {
            const x = { ...v, id: links.get(v.recordedId)?.id || 40 };
            links.set(v.recordedId, x);
            return x;
        },
        findAlias: async () => null,
        upsertPendingMatch: async () => {},
        deletePendingMatchByRecordedId: async () => {},
        getSeries: async id => candidates.find(c => c.id === id) || null,
    };
}
function resolver(db, threshold = 0.8) {
    return new SeriesResolver(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) },
        { getAll: async () => ({ series: { matchThreshold: threshold } }) },
        db,
    );
}
test('title similarity handles exact and unrelated titles', () => {
    assert.equal(titleSimilarity('作品名', '作品名'), 1);
    assert.equal(titleSimilarity('作品名', 'ニュース'), 0);
});
test('same programme across stations maps to existing series and episode', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    const link = await resolver(db).resolve({ recordedId: 5, title: '作品名 第3話', channelId: 20, startAt: 100 });
    assert.equal(link.seriesId, 1);
    assert.equal(link.episodeId, 30);
    assert.equal(db.episodes[0].episodeNumber, 3);
});
test('rerun reuses episode and records air type', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    await resolver(db).resolve({ recordedId: 1, title: '作品名 第3話', channelId: 10, startAt: 100 });
    const link = await resolver(db).resolve({
        recordedId: 2,
        title: '【再】作品名 第3話',
        channelId: 20,
        startAt: 200,
    });
    assert.equal(link.episodeId, 30);
    assert.equal(link.airType, 'rerun');
});
test('manual links are never overwritten', async () => {
    const db = memory();
    db.links.set(9, { id: 1, recordedId: 9, seriesId: 99, manualLock: true });
    const link = await resolver(db).resolve({ recordedId: 9, title: '別作品 第1話', channelId: 1, startAt: 1 });
    assert.equal(link.seriesId, 99);
});
test('feature flag keeps resolver disabled', async () => {
    const db = memory();
    const r = new SeriesResolver({ getConfig: () => ({ featureFlags: {} }) }, { getAll: async () => ({}) }, db);
    assert.equal(await r.resolve({ recordedId: 1, title: 'x', channelId: 1, startAt: 1 }), null);
});
