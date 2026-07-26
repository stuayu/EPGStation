'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const WatchHistoryApiModel = require('../../dist/model/api/video/WatchHistoryApiModel').default;

const config = enabled => ({ getConfig: () => ({ featureFlags: { watchHistory: enabled } }) });

const noopAnnictSyncQueue = { enqueueFromWatchHistory: () => {} };

test('watch history API keeps legacy behavior while the flag is off', async () => {
    const model = new WatchHistoryApiModel(config(false), {}, {}, noopAnnictSyncQueue);
    await assert.rejects(() => model.get(1), /WatchHistoryFeatureIsDisabled/);
});

test('watch history API validates video existence and persists normalized state', async () => {
    let stored = null;
    const db = {
        findByVideoFileId: async () => stored,
        upsert: async value => (stored = { id: 1, userId: null, ...value }),
    };
    const videos = { findId: async id => (id === 7 ? { id: 7, recordedId: 70 } : null) };
    const model = new WatchHistoryApiModel(config(true), db, videos, noopAnnictSyncQueue);

    assert.equal(await model.update(999, { position: 1, duration: 10 }), null);
    const updated = await model.update(7, { position: 95, duration: 100 });
    assert.equal(updated.recordedId, 70);
    assert.equal(updated.status, 'watched');
    assert.equal((await model.get(7)).position, 95);
});

// §5.5: watched への遷移をトリガーに Annict 同期キューへ積む (直前が既に watched なら再トリガーしない)
test('triggers the Annict sync queue only on the unwatched/watching -> watched transition', async () => {
    let stored = null;
    const db = {
        findByVideoFileId: async () => stored,
        upsert: async value => (stored = { id: 1, userId: null, ...value }),
    };
    const videos = { findId: async () => ({ id: 7, recordedId: 70 }) };
    const calls = [];
    const annictSyncQueue = { enqueueFromWatchHistory: recordedId => calls.push(recordedId) };
    const model = new WatchHistoryApiModel(config(true), db, videos, annictSyncQueue);

    await model.update(7, { position: 10, duration: 100 }); // watching へ
    assert.deepEqual(calls, []);
    await model.update(7, { position: 95, duration: 100 }); // watched へ (トリガー)
    assert.deepEqual(calls, [70]);
    await model.update(7, { position: 96, duration: 100 }); // 既に watched (再トリガーしない)
    assert.deepEqual(calls, [70]);
});
