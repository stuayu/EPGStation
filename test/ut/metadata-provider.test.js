'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Registry = require('../../dist/model/metadata/MetadataProviderRegistry').default;
const Service = require('../../dist/model/metadata/MetadataService').default;
test('registry rejects duplicate provider names', () => {
    const r = new Registry();
    r.register({ name: 'x' });
    assert.throws(() => r.register({ name: 'x' }), /AlreadyRegistered/);
});
test('service merges provider results by score and tolerates failures', async () => {
    const r = new Registry();
    r.register(
        {
            name: 'a',
            search: async () => [{ provider: 'a', externalId: '1', title: 'A', score: 0.7 }],
            get: async () => null,
        },
        { name: 'annict', search: async () => [], get: async () => null },
    );
    r.register(
        {
            name: 'b',
            search: async () => {
                throw Error('down');
            },
            get: async () => null,
        },
        { name: 'annict', search: async () => [], get: async () => null },
    );
    const s = new Service(
        { getConfig: () => ({ featureFlags: { metadataProviders: true } }) },
        r,
        {
            get: async () => null,
            put: async () => {},
            deleteExpired: async () => {},
        },
        { name: 'syobocal', search: async () => [], get: async () => null },
        { name: 'annict', search: async () => [], get: async () => null },
    );
    const x = await s.search('title');
    assert.equal(x.length, 1);
    assert.equal(x[0].provider, 'a');
});
test('service caches provider detail', async () => {
    let calls = 0;
    const r = new Registry();
    r.register({
        name: 'a',
        search: async () => [],
        get: async () => {
            calls++;
            return { provider: 'a', externalId: '1', title: 'A', score: 1 };
        },
    });
    let stored = null;
    const cache = {
        get: async () => stored,
        put: async (p, e, v) => {
            stored = { provider: p, externalId: e, payload: JSON.stringify(v), expiresAt: Date.now() + 10000 };
        },
        deleteExpired: async () => {},
    };
    const s = new Service(
        { getConfig: () => ({ featureFlags: { metadataProviders: true } }) },
        r,
        cache,
        {
            name: 'syobocal',
            search: async () => [],
            get: async () => null,
        },
        { name: 'annict', search: async () => [], get: async () => null },
    );
    await s.get('a', '1');
    await s.get('a', '1');
    assert.equal(calls, 1);
});
