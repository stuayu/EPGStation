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
