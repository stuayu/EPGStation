'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesBackfillApiModel = require('../../dist/model/api/series/SeriesBackfillApiModel').default;

function buildModel({ enabled, ipc }) {
    return new SeriesBackfillApiModel({ getConfig: () => ({ featureFlags: { seriesLibrary: enabled } }) }, ipc);
}

test('start / getStatus / cancel reject while the seriesLibrary feature flag is off', async () => {
    const model = buildModel({ enabled: false, ipc: {} });
    await assert.rejects(() => model.start({}), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.getStatus(), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.cancel(), /SeriesLibraryFeatureIsDisabled/);
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
    assert.deepEqual(sentOption, { dryRun: false, chunkSize: 20 });
    assert.equal(result.state, 'running');

    await model.start({ dryRun: true });
    assert.deepEqual(sentOption, { dryRun: true, chunkSize: undefined });
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
