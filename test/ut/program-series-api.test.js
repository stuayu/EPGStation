'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/api/schedule/ProgramSeriesApiModel').default;
test('EPG program lazily maps to existing series and episode', async () => {
    let saved;
    const m = new Model(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true, programSeriesMapping: true } }) },
        { findId: async () => ({ id: 100, name: '作品名 第2話', channelId: 10, startAt: 1000 }) },
        { get: async () => null, save: async x => (saved = { ...x, id: 1 }) },
        {
            findCandidates: async () => [{ id: 5, normalizedTitle: '作品名' }],
            findEpisode: async () => null,
            createEpisode: async x => ({ ...x, id: 6 }),
        },
    );
    const x = await m.get(100);
    assert.equal(x.seriesId, 5);
    assert.equal(x.episodeId, 6);
    assert.equal(saved.source, 'epg');
});
test('program mapping is stable after first resolution', async () => {
    const m = new Model(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true, programSeriesMapping: true } }) },
        {
            findId: async () => {
                throw Error('unexpected');
            },
        },
        {
            get: async () => ({ programId: 1, seriesId: 2, episodeId: null, confidence: 0.9, source: 'epg' }),
            save: async () => {},
        },
        {},
    );
    assert.equal((await m.get(1)).seriesId, 2);
});
