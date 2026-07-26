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
test('pushWatchRecord finds the episode by number, creates a record and syncs the work status', async () => {
    const calls = [];
    const http = {
        post: async (u, b) => {
            const body = JSON.parse(b);
            calls.push(body);
            if (body.query.includes('WorkEpisodes')) {
                return {
                    status: 200,
                    json: () => ({
                        data: {
                            works: {
                                nodes: [
                                    {
                                        id: 'work-1',
                                        episodes: { nodes: [{ id: 'ep-1', number: 1 }, { id: 'ep-2', number: 2 }] },
                                    },
                                ],
                            },
                        },
                    }),
                };
            }
            if (body.query.includes('CreateRecord')) {
                assert.equal(body.variables.episodeId, 'ep-2');
                return { status: 200, json: () => ({ data: { createRecord: { record: { id: 'rec-1' } } } }) };
            }
            if (body.query.includes('UpdateStatus')) {
                assert.equal(body.variables.workId, 'work-1');
                assert.equal(body.variables.state, 'WATCHED');
                return { status: 200, json: () => ({ data: { updateStatus: { work: { id: 'work-1' } } } }) };
            }
            throw new Error(`unexpected query: ${body.query}`);
        },
    };
    const result = await new Provider(http, settings, crypto).pushWatchRecord('42', 2, 'watched');
    assert.equal(result.recordId, 'rec-1');
    assert.equal(calls.length, 3);
});
test('pushWatchRecord throws when the episode number cannot be found (e.g. delayed broadcast not yet registered)', async () => {
    const http = {
        post: async () => ({
            status: 200,
            json: () => ({ data: { works: { nodes: [{ id: 'work-1', episodes: { nodes: [{ id: 'ep-1', number: 1 }] } }] } } }),
        }),
    };
    await assert.rejects(
        () => new Provider(http, settings, crypto).pushWatchRecord('42', 99, 'watched'),
        /AnnictEpisodeIsNotFound/,
    );
});
test('pushWatchRecord returns null when Annict is not configured (no token)', async () => {
    const p = new Provider(
        { post: async () => { throw new Error('unexpected'); } },
        { getAll: async () => ({ metadata: { annict: { enabled: false } } }) },
        crypto,
    );
    assert.equal(await p.pushWatchRecord('42', 1, 'watched'), null);
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
