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
