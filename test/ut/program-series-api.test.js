'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/api/schedule/ProgramSeriesApiModel').default;
test('precompute maps EPG program to an existing series/episode above threshold', async () => {
    let saved;
    let metrics;
    const m = new Model(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true, programSeriesMapping: true } }) },
        { findId: async () => ({ id: 100, name: '作品名 第2話', channelId: 10, startAt: 1000 }) },
        { get: async () => null, save: async x => (saved = { ...x, id: 1 }) },
        {
            findCandidates: async () => [{ id: 5, normalizedTitle: '作品名', preferredChannelId: 10 }],
            findEpisode: async () => null,
            createEpisode: async x => ({ ...x, id: 6 }),
        },
        {
            getAll: async () => ({}),
            upsert: async v => (metrics = v.programSeriesMetrics),
        },
    );
    const result = await m.precompute([100]);
    assert.equal(result.matched, 1);
    assert.equal(saved.seriesId, 5);
    assert.equal(saved.episodeId, 6);
    assert.equal(saved.source, 'epg');
    assert.equal(metrics.matchedPrograms, 1);
});
test('precompute does not confirm below-threshold matches (pending queue)', async () => {
    let saved = null;
    const m = new Model(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true, programSeriesMapping: true } }) },
        { findId: async () => ({ id: 200, name: '全然違うタイトル', channelId: 10, startAt: 1000 }) },
        { get: async () => null, save: async x => (saved = x) },
        {
            findCandidates: async () => [{ id: 5, normalizedTitle: '無関係の作品', preferredChannelId: 99 }],
        },
        { getAll: async () => ({}), upsert: async () => {} },
    );
    const result = await m.precompute([200]);
    assert.equal(result.pending, 1);
    assert.equal(saved, null);
});
test('get() is read-only and returns the already-saved mapping without writing', async () => {
    const m = new Model(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true, programSeriesMapping: true } }) },
        {
            findId: async () => {
                throw Error('get() must not touch IProgramDB');
            },
        },
        {
            get: async () => ({ programId: 1, seriesId: 2, episodeId: null, confidence: 0.9, source: 'epg' }),
        },
        {
            createSeries: async () => {
                throw Error('get() must not create a series');
            },
        },
        { getAll: async () => ({}) },
    );
    assert.equal((await m.get(1)).seriesId, 2);
});
test('get() returns null when no precomputed mapping exists yet', async () => {
    const m = new Model(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true, programSeriesMapping: true } }) },
        {},
        { get: async () => null },
        {},
        { getAll: async () => ({}) },
    );
    assert.equal(await m.get(999), null);
});
