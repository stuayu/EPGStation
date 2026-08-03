'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/api/recorded/RecordedApiModel').default;
const recorded = id => ({
    id,
    channelId: 1,
    startAt: id,
    endAt: id + 1,
    videoFiles: [{ id: id * 10, type: 'encoded' }],
});
const itemUtil = {
    convertRecordedToRecordedItem: r => ({
        id: r.id,
        channelId: r.channelId,
        startAt: r.startAt,
        endAt: r.endAt,
        name: `R${r.id}`,
        videoFiles: r.videoFiles,
    }),
};
const base = (feature = true) =>
    new Model(
        {},
        {
            findAll: async () => [[recorded(5), recorded(4), recorded(3)], 3],
            findId: async () => recorded(5),
            findIds: async ids => ids.map(recorded),
        },
        { getRecordedIndex: () => ({}) },
        itemUtil,
        { getConfig: () => ({ featureFlags: { watchHistory: true, nextUpPanel: feature } }) },
        {
            findByVideoFileIds: async () => [
                { videoFileId: 40, recordedId: 4, position: 10, duration: 100, status: 'watching', updatedAt: 1 },
            ],
        },
        { findLink: async () => ({ seriesId: 9 }), listRecorded: async () => [{ recordedId: 3 }, { recordedId: 4 }] },
    );
test('next up returns latest and series lists with watch history', async () => {
    const x = await base().getNextUp(5, false);
    assert.deepEqual(
        x.latest.map(v => v.id),
        [4, 3],
    );
    assert.deepEqual(
        x.series.map(v => v.id),
        [3, 4],
    );
    assert.equal(x.currentSeriesId, 9);
    assert.equal(x.latest[0].videoFiles[0].watchHistory.status, 'watching');
});
test('next up respects feature flag', async () => {
    await assert.rejects(() => base(false).getNextUp(5, false), /NextUpPanelFeatureIsDisabled/);
});

// 無限スクロール用のページング。latest / series それぞれ続きの有無を返す
const paged = (seriesCount, latestCount) => {
    const calls = [];

    return {
        calls,
        model: new Model(
            {},
            {
                findAll: async option => {
                    calls.push(option);
                    const ids = [];
                    for (let i = 0; i < latestCount; i++) ids.push(100 + i);

                    return [ids.slice(option.offset, option.offset + option.limit).map(recorded), latestCount];
                },
                findId: async () => recorded(5),
                findIds: async ids => ids.map(recorded),
            },
            { getRecordedIndex: () => ({}) },
            itemUtil,
            { getConfig: () => ({ featureFlags: {} }) },
            { findByVideoFileIds: async () => [] },
            {
                findLink: async () => ({ seriesId: 9 }),
                listRecorded: async () => {
                    const rows = [];
                    for (let i = 0; i < seriesCount; i++) rows.push({ recordedId: 200 + i });

                    return rows;
                },
            },
        ),
    };
};

test('next up paginates both lists and reports hasMore', async () => {
    const { model } = paged(30, 30);

    const first = await model.getNextUp(5, false, { limit: 10, offset: 0 });
    assert.equal(first.latest.length, 10);
    assert.equal(first.series.length, 10);
    assert.equal(first.hasMoreLatest, true);
    assert.equal(first.hasMoreSeries, true);

    const last = await model.getNextUp(5, false, { limit: 10, offset: 20 });
    assert.equal(last.series.length, 10);
    assert.equal(last.hasMoreSeries, false);
});

test('next up target loads only the requested list', async () => {
    const { model, calls } = paged(30, 30);

    const result = await model.getNextUp(5, false, { limit: 10, offset: 10, target: 'series' });
    assert.equal(result.latest.length, 0);
    assert.equal(result.series.length, 10);
    // 新着側の DB クエリは走らない
    assert.equal(calls.length, 0);
});

test('next up clamps limit to the maximum', async () => {
    const { model, calls } = paged(0, 300);

    await model.getNextUp(5, false, { limit: 1000, target: 'latest' });
    assert.equal(calls[0].limit, 102);
});
