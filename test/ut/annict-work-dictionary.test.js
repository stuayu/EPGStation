'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const AnnictWorkDictionary = require('../../dist/model/metadata/annict/AnnictWorkDictionary').default;

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

const logger = { getLogger: () => ({ system: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } }) };
const crypto = { isEncrypted: () => false, decrypt: v => v, encrypt: v => v };

function makeDB() {
    const works = new Map();
    const aliases = [];
    return {
        works,
        aliases,
        bulkUpsert: async values => {
            for (const value of values) {
                works.set(value.work.annictId, value.work);
                aliases.push(...value.aliases);
            }
        },
        count: async () => works.size,
        countLinkedToSyobocal: async () => [...works.values()].filter(x => x.syobocalTid !== null).length,
        listAllAliases: async () => aliases,
        get: async id => works.get(id) ?? null,
        findBySyobocalTid: async tid => [...works.values()].find(x => x.syobocalTid === tid) ?? null,
        clear: async () => {
            works.clear();
            aliases.length = 0;
        },
    };
}

/**
 * pages: 1 ページ分の nodes 配列の配列
 */
function makeDictionary({ pages = [[]], enabled = true, token = 'test-token', onRequest = () => {} } = {}) {
    let page = 0;
    const http = {
        get: async () => ({ text: '' }),
        post: async (url, body) => {
            onRequest(JSON.parse(body));
            const nodes = pages[page] ?? [];
            page++;
            return {
                status: 200,
                json: () => ({
                    data: {
                        searchWorks: {
                            pageInfo: { hasNextPage: page < pages.length, endCursor: String(page) },
                            nodes,
                        },
                    },
                }),
            };
        },
    };
    const settings = { getAll: async () => ({ metadata: { annict: { enabled, token } } }) };
    const config = { getConfig: () => ({ featureFlags: { metadataProviders: true }, metadataDefaults: {} }) };
    const db = makeDB();
    return { dictionary: new AnnictWorkDictionary(logger, http, db, settings, crypto, config, endpoints), db };
}

test('sync() imports works and their english / romaji / kana titles as aliases', async () => {
    const { dictionary, db } = makeDictionary({
        pages: [
            [
                {
                    annictId: 1,
                    title: '銀河英雄伝説 Die Neue These',
                    titleEn: 'Legend of the Galactic Heroes',
                    titleRo: 'Ginga Eiyu Densetsu',
                    titleKana: 'ぎんがえいゆうでんせつ',
                    syobocalTid: 4321,
                    seasonYear: 2018,
                    seasonName: 'SPRING',
                    episodesCount: 12,
                    media: 'TV',
                },
            ],
        ],
    });

    const result = await dictionary.sync();

    assert.equal(result.error, null);
    assert.equal(result.imported, 1);
    assert.equal(result.workCount, 1);
    assert.equal(result.linkedToSyobocalCount, 1);
    const work = db.works.get(1);
    assert.equal(work.syobocalTid, 4321);
    assert.equal(work.episodesCount, 12);
    // 英題・ローマ字・かなが照合キーとして登録される
    assert.equal(db.aliases.length, 3);
    assert.ok(db.aliases.every(x => x.annictId === 1 && x.rank === 2));
});

test('sync() follows pagination until hasNextPage becomes false', async () => {
    const requests = [];
    const { dictionary } = makeDictionary({
        pages: [
            [{ annictId: 1, title: '作品1' }],
            [{ annictId: 2, title: '作品2' }],
            [{ annictId: 3, title: '作品3' }],
        ],
        onRequest: body => requests.push(body.variables),
    });

    const result = await dictionary.sync();

    assert.equal(result.imported, 3);
    assert.equal(requests.length, 3);
    // 1 ページ目はカーソル無し、2 ページ目以降は前ページの endCursor を渡す
    assert.equal(requests[0].after, null);
    assert.equal(requests[1].after, '1');
    assert.equal(requests[2].after, '2');
});

test('sync() skips works without an id or a title', async () => {
    const { dictionary, db } = makeDictionary({
        pages: [[{ annictId: 1, title: '有効な作品' }, { annictId: 2, title: '' }, { title: 'ID なし' }]],
    });

    const result = await dictionary.sync();

    assert.equal(result.imported, 1);
    assert.equal(db.works.size, 1);
});

test('sync() reports an error instead of throwing when the token is missing', async () => {
    const { dictionary } = makeDictionary({ token: '' });

    const result = await dictionary.sync();

    assert.equal(result.error, 'AnnictTokenIsNotConfigured');
    assert.equal(result.imported, 0);
});

test('sync() reports an error when Annict returns a GraphQL error', async () => {
    const http = {
        get: async () => ({ text: '' }),
        post: async () => ({ status: 200, json: () => ({ errors: [{ message: "Field 'works' doesn't exist" }] }) }),
    };
    const settings = { getAll: async () => ({ metadata: { annict: { enabled: true, token: 't' } } }) };
    const config = { getConfig: () => ({ featureFlags: { metadataProviders: true }, metadataDefaults: {} }) };
    const dictionary = new AnnictWorkDictionary(logger, http, makeDB(), settings, crypto, config, endpoints);

    const result = await dictionary.sync();

    assert.ok(result.error.startsWith('AnnictGraphQLError:'), result.error);
    assert.equal(result.imported, 0);
});

test('sync() reports an authentication failure for a 401 response', async () => {
    const http = {
        get: async () => ({ text: '' }),
        post: async () => ({ status: 401, json: () => ({}) }),
    };
    const settings = { getAll: async () => ({ metadata: { annict: { enabled: true, token: 't' } } }) };
    const config = { getConfig: () => ({ featureFlags: { metadataProviders: true }, metadataDefaults: {} }) };
    const dictionary = new AnnictWorkDictionary(logger, http, makeDB(), settings, crypto, config, endpoints);

    assert.equal((await dictionary.sync()).error, 'AnnictAuthenticationFailed');
});
