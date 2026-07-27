'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesApiModel = require('../../dist/model/api/series/SeriesApiModel').default;
const series = {
    id: 1,
    title: '作品',
    normalizedTitle: '作品',
    mediaType: 'tv',
    preferredChannelId: 10,
    syobocalTid: null,
    annictId: null,
    tmdbId: null,
    updatedAt: 200,
};
const db = {
    list: async (_k, o, l) => {
        assert.equal(o, 0);
        assert.equal(l, 100);
        return [[series], 1];
    },
    getSeries: async id => (id === 1 ? series : null),
    listRecorded: async (_id, ch) =>
        [
            {
                recordedId: '2',
                channelId: '10',
                channelName: '局',
                recordedTitle: '作品 第1話',
                startAt: '100',
                endAt: '200',
                episodeId: '3',
                seasonNumber: '1',
                episodeNumber: '1',
                episodeLabel: '第1話',
                episodeTitle: null,
                airType: 'first',
                confidence: '0.9',
            },
        ].filter(x => ch === undefined || Number(x.channelId) === ch),
    listChannels: async () => [{ channelId: 10, channelName: '局', count: '1' }],
};
// アイキャッチ画像は装飾なので、既定では「画像なし」を返すスタブを渡す
const imageModel = { getInfo: async () => null, getInfoMap: async () => new Map(), getFile: async () => null };
const model = new SeriesApiModel({ getConfig: () => ({ featureFlags: { seriesLibrary: true } }) }, db, imageModel);
test('series API clamps pagination and returns total', async () => {
    const x = await model.list('作品', -2, 500);
    assert.equal(x.total, 1);
    assert.equal(x.items[0].id, 1);
});
test('series detail supports channel filtering and numeric conversion', async () => {
    const x = await model.get(1, 10);
    assert.equal(x.recorded[0].episodeNumber, 1);
    assert.equal(x.channels[0].count, 1);
});
test('series API is hidden while feature is disabled', async () => {
    const m = new SeriesApiModel({ getConfig: () => ({ featureFlags: {} }) }, db, imageModel);
    await assert.rejects(() => m.list(undefined, 0, 10), /SeriesLibraryFeatureIsDisabled/);
});
