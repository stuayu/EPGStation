'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/api/series/AnnictSyncApiModel').default;
test('Annict sync stores Annict and Syobocal IDs', async () => {
    let updated;
    const m = new Model(
        { getConfig: () => ({ featureFlags: { metadataProviders: true, annictSync: true } }) },
        {
            getSeries: async () => ({ id: 1, title: '作品', syobocalTid: null }),
            updateExternalMetadata: async (_id, v) => (updated = v),
        },
        { search: async () => [{ provider: 'annict', externalId: '42', title: '作品', score: 1, syobocalTid: 99 }] },
    );
    const x = await m.sync(1);
    assert.equal(x.annictId, '42');
    assert.deepEqual(updated, { annictId: '42', syobocalTid: 99 });
});
test('Annict sync uses the known syobocalTid to bypass title-score threshold and pick the exact work', async () => {
    let searchContext;
    let updated;
    const m = new Model(
        { getConfig: () => ({ featureFlags: { metadataProviders: true, annictSync: true } }) },
        {
            getSeries: async () => ({ id: 1, title: '作品', syobocalTid: 99 }),
            updateExternalMetadata: async (_id, v) => (updated = v),
        },
        {
            search: async (_q, context) => {
                searchContext = context;
                return [
                    { provider: 'annict', externalId: '1', title: '似た別作品', score: 0.5, syobocalTid: 11 },
                    { provider: 'annict', externalId: '42', title: '別の表記', score: 0.4, syobocalTid: 99 },
                ];
            },
        },
    );
    const x = await m.sync(1);
    assert.equal(searchContext.syobocalTid, 99);
    assert.equal(x.annictId, '42');
    assert.deepEqual(updated, { annictId: '42', syobocalTid: 99 });
});
