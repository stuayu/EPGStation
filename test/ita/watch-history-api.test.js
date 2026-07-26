'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const WatchHistoryApiModel = require('../../dist/model/api/video/WatchHistoryApiModel').default;

const config = enabled => ({ getConfig: () => ({ featureFlags: { watchHistory: enabled } }) });

test('watch history API keeps legacy behavior while the flag is off', async () => {
    const model = new WatchHistoryApiModel(config(false), {}, {});
    await assert.rejects(() => model.get(1), /WatchHistoryFeatureIsDisabled/);
});

test('watch history API validates video existence and persists normalized state', async () => {
    let stored = null;
    const db = {
        findByVideoFileId: async () => stored,
        upsert: async value => (stored = { id: 1, userId: null, ...value }),
    };
    const videos = { findId: async id => (id === 7 ? { id: 7, recordedId: 70 } : null) };
    const model = new WatchHistoryApiModel(config(true), db, videos);

    assert.equal(await model.update(999, { position: 1, duration: 10 }), null);
    const updated = await model.update(7, { position: 95, duration: 100 });
    assert.equal(updated.recordedId, 70);
    assert.equal(updated.status, 'watched');
    assert.equal((await model.get(7)).position, 95);
});
