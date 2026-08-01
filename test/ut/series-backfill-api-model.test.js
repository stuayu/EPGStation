'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesBackfillApiModel = require('../../dist/model/api/series/SeriesBackfillApiModel').default;

function buildModel({ enabled, ipc }) {
    return new SeriesBackfillApiModel({ getConfig: () => ({ featureFlags: { seriesLibrary: enabled } }) }, ipc);
}

test('start / getStatus / cancel / analyze reject while the seriesLibrary feature flag is off', async () => {
    const model = buildModel({ enabled: false, ipc: {} });
    await assert.rejects(() => model.start({}), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.getStatus(), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.cancel(), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.analyze(1), /SeriesLibraryFeatureIsDisabled/);
});

test('start() delegates to IPC, normalizing dryRun/chunkSize before forwarding', async () => {
    let sentOption;
    const ipc = {
        series: {
            startBackfill: async option => {
                sentOption = option;
                return { state: 'running' };
            },
        },
    };
    const model = buildModel({ enabled: true, ipc });

    const result = await model.start({ chunkSize: 20 });
    assert.deepEqual(sentOption, {
        dryRun: false,
        chunkSize: 20,
        restart: false,
        onlyUnlinked: false,
        latest: undefined,
    });
    assert.equal(result.state, 'running');

    await model.start({ dryRun: true });
    assert.deepEqual(sentOption, {
        dryRun: true,
        chunkSize: undefined,
        restart: false,
        onlyUnlinked: false,
        latest: undefined,
    });

    // 絞り込み条件はそのまま Operator へ渡す
    await model.start({ onlyUnlinked: true, latest: 30 });
    assert.deepEqual(sentOption, {
        dryRun: false,
        chunkSize: undefined,
        restart: false,
        onlyUnlinked: true,
        latest: 30,
    });
});

test('analyze() delegates to IPC with the recordedId', async () => {
    let requestedId = null;
    const ipc = {
        series: {
            analyze: async recordedId => {
                requestedId = recordedId;
                return { recordedId, linked: true, steps: [] };
            },
        },
    };
    const model = buildModel({ enabled: true, ipc });

    const result = await model.analyze(42);
    assert.equal(requestedId, 42);
    assert.equal(result.linked, true);
});

test('getStatus() and cancel() delegate to IPC', async () => {
    let canceled = false;
    const ipc = {
        series: {
            getBackfillStatus: async () => ({ state: 'completed' }),
            cancelBackfill: async () => {
                canceled = true;
            },
        },
    };
    const model = buildModel({ enabled: true, ipc });

    assert.equal((await model.getStatus()).state, 'completed');
    await model.cancel();
    assert.equal(canceled, true);
});
