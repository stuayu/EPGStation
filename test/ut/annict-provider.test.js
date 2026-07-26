'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Provider = require('../../dist/model/metadata/annict/AnnictProvider').default;
const settings = { getAll: async () => ({ metadata: { annict: { enabled: true, token: 'enc-token' } } }) };
const crypto = { isEncrypted: v => v === 'enc-token', decrypt: () => 'plain-token' };
test('Annict search sends decrypted bearer token and normalizes works', async () => {
    let request;
    const http = {
        post: async (u, b, o) => {
            request = { u, b, o };
            return {
                status: 200,
                json: () => ({
                    data: {
                        searchWorks: { nodes: [{ annictId: 42, title: '作品', seasonYear: 2024, syobocalTid: 99 }] },
                    },
                }),
            };
        },
    };
    const x = await new Provider(http, settings, crypto).search('作品');
    assert.equal(x[0].externalId, '42');
    assert.equal(x[0].syobocalTid, 99);
    assert.equal(request.o.headers.authorization, 'Bearer plain-token');
});
test('Annict provider rejects GraphQL errors', async () => {
    const http = { post: async () => ({ status: 200, json: () => ({ errors: [{ message: 'bad' }] }) }) };
    await assert.rejects(() => new Provider(http, settings, crypto).search('作品'), /AnnictGraphQLError/);
});
test('search bypasses title matching and uniquely resolves by syobocalTid when the chain provides it', async () => {
    const http = {
        post: async () => ({
            status: 200,
            json: () => ({
                data: {
                    searchWorks: {
                        nodes: [
                            { annictId: 1, title: '似た別作品', seasonYear: 2020, syobocalTid: 11 },
                            { annictId: 42, title: '全然違う表記の作品', seasonYear: 2024, syobocalTid: 99 },
                        ],
                    },
                },
            }),
        }),
    };
    const x = await new Provider(http, settings, crypto).search('作品', { syobocalTid: 99 });
    assert.equal(x.length, 1);
    assert.equal(x[0].externalId, '42');
    assert.equal(x[0].score, 1);
});
test('disabled Annict performs no request', async () => {
    const p = new Provider(
        {
            post: async () => {
                throw Error('unexpected');
            },
        },
        { getAll: async () => ({ metadata: { annict: { enabled: false } } }) },
        crypto,
    );
    assert.deepEqual(await p.search('作品'), []);
});
