'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Provider = require('../../dist/model/metadata/annict/AnnictProvider').default;

// 外部サービスのエンドポイントは設定で差し替え可能なため、既定値を返すスタブを渡す
const endpoints = {
    resolve: async name =>
        ({
            syobocal: 'https://cal.syoboi.jp/db.php',
            annict: 'https://api.annict.com/graphql',
            fxtwitter: 'https://api.fxtwitter.com/',
            sharedData: '',
        })[name],
    getDefaults: () => ({}),
};
const settings = { getAll: async () => ({ metadata: { annict: { enabled: true, token: 'enc-token' } } }) };
const crypto = { isEncrypted: v => v === 'enc-token', decrypt: () => 'plain-token' };
const config = { getConfig: () => ({}) };
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
    const x = await new Provider(http, settings, crypto, config, endpoints).search('作品');
    assert.equal(x[0].externalId, '42');
    assert.equal(x[0].syobocalTid, 99);
    assert.equal(request.o.headers.authorization, 'Bearer plain-token');
});
test('Annict provider rejects GraphQL errors', async () => {
    const http = { post: async () => ({ status: 200, json: () => ({ errors: [{ message: 'bad' }] }) }) };
    await assert.rejects(() => new Provider(http, settings, crypto, config, endpoints).search('作品'), /AnnictGraphQLError/);
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
    const x = await new Provider(http, settings, crypto, config, endpoints).search('作品', { syobocalTid: 99 });
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
                            searchWorks: {
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
    const result = await new Provider(http, settings, crypto, config, endpoints).pushWatchRecord('42', 2, 'watched');
    assert.equal(result.recordId, 'rec-1');
    assert.equal(calls.length, 3);
});
test('pushWatchRecord throws when the episode number cannot be found (e.g. delayed broadcast not yet registered)', async () => {
    const http = {
        post: async () => ({
            status: 200,
            json: () => ({ data: { searchWorks: { nodes: [{ id: 'work-1', episodes: { nodes: [{ id: 'ep-1', number: 1 }] } }] } } }),
        }),
    };
    await assert.rejects(
        () => new Provider(http, settings, crypto, config, endpoints).pushWatchRecord('42', 99, 'watched'),
        /AnnictEpisodeIsNotFound/,
    );
});
test('pushWatchRecord returns null when Annict is not configured (no token)', async () => {
    const p = new Provider(
        { post: async () => { throw new Error('unexpected'); } },
        { getAll: async () => ({ metadata: { annict: { enabled: false } } }) },
        crypto,
        config,
    );
    assert.equal(await p.pushWatchRecord('42', 1, 'watched'), null);
});
// 接続テスト (§6.2): viewer クエリで疎通・トークンの有効性を確認する専用 API 用
test('testConnection succeeds and returns the Annict username', async () => {
    const http = { post: async () => ({ status: 200, json: () => ({ data: { viewer: { username: 'testuser' } } }) }) };
    const result = await new Provider(http, settings, crypto, config, endpoints).testConnection();
    assert.deepEqual(result, { ok: true, username: 'testuser' });
});
test('testConnection reports failure when the token is invalid (401/403)', async () => {
    const http = { post: async () => ({ status: 401, json: () => ({}) }) };
    const result = await new Provider(http, settings, crypto, config, endpoints).testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.message, 'AnnictAuthenticationFailed');
});
test('testConnection reports failure on a network/HTTP error without throwing', async () => {
    const http = {
        post: async () => {
            throw new Error('network unreachable');
        },
    };
    const result = await new Provider(http, settings, crypto, config, endpoints).testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.message, 'network unreachable');
});
test('testConnection reports AnnictIsDisabled when the Annict integration is turned off', async () => {
    const p = new Provider(
        { post: async () => { throw new Error('unexpected'); } },
        { getAll: async () => ({ metadata: { annict: { enabled: false } } }) },
        crypto,
        config,
    );
    const result = await p.testConnection();
    assert.deepEqual(result, { ok: false, message: 'AnnictIsDisabled' });
});
test('testConnection reports AnnictAuthenticationFailed when viewer is null (revoked token)', async () => {
    const http = { post: async () => ({ status: 200, json: () => ({ data: { viewer: null } }) }) };
    const result = await new Provider(http, settings, crypto, config, endpoints).testConnection();
    assert.deepEqual(result, { ok: false, message: 'AnnictAuthenticationFailed' });
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
        config,
    );
    assert.deepEqual(await p.search('作品'), []);
});
