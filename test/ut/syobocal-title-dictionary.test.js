'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SyobocalTitleDictionary = require('../../dist/model/metadata/syobocal/SyobocalTitleDictionary').default;

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

function makeDB() {
    const titles = new Map();
    const aliases = [];
    const episodes = new Map();
    return {
        titles,
        aliases,
        bulkUpsert: async values => {
            for (const value of values) {
                titles.set(value.title.tid, value.title);
                for (const alias of value.aliases) aliases.push(alias);
                episodes.set(value.title.tid, value.episodes);
            }
        },
        count: async () => titles.size,
        getLatestLastUpdate: async () =>
            [...titles.values()].map(x => x.lastUpdate).sort().pop() ?? null,
        listAllAliases: async () => [
            ...[...titles.values()].map(x => ({ lookupKey: x.lookupKey, tid: x.tid, rank: 0 })),
            ...aliases,
        ],
        get: async tid => titles.get(tid) ?? null,
        listEpisodes: async tid => episodes.get(tid) ?? [],
        clear: async () => {
            titles.clear();
            aliases.length = 0;
            episodes.clear();
        },
    };
}

function titleItem({ tid, title, shortTitle = '', titleEn = '', keywords = '', subTitles = '', lastUpdate = '2026-07-01 00:00:00' }) {
    return (
        `<TitleItem id="${tid}"><TID>${tid}</TID><Title>${title}</Title>` +
        `<ShortTitle>${shortTitle}</ShortTitle><TitleYomi></TitleYomi><TitleEN>${titleEn}</TitleEN>` +
        `<Keywords>${keywords}</Keywords><Cat>1</Cat><FirstYear>2025</FirstYear><FirstMonth>1</FirstMonth>` +
        `<SubTitles>${subTitles}</SubTitles><LastUpdate>${lastUpdate}</LastUpdate></TitleItem>`
    );
}

function makeXml(items) {
    return `<?xml version="1.0" encoding="UTF-8"?><TitleLookupResponse><Result><Code>200</Code></Result><TitleItems>${items.join('')}</TitleItems></TitleLookupResponse>`;
}

function makeDictionary({ db = makeDB(), xml = makeXml([]), enabled = true, onRequest = () => {} } = {}) {
    const http = {
        get: async url => {
            onRequest(url);
            return { text: typeof xml === 'function' ? xml(url) : xml };
        },
        post: async () => ({ text: '' }),
    };
    const settings = { getAll: async () => ({ metadata: { syobocal: { enabled } } }) };
    const config = { getConfig: () => ({ featureFlags: { metadataProviders: true }, metadataDefaults: {} }) };
    return { dictionary: new SyobocalTitleDictionary(logger, http, db, settings, config, endpoints), db };
}

test('sync() imports titles, aliases and sub titles from the bulk TitleLookup response', async () => {
    const xml = makeXml([
        titleItem({
            tid: 1,
            title: 'ざつ旅-That’s Journey-',
            shortTitle: 'ざつ旅',
            keywords: 'ざつ旅 ざっつじゃーにー',
            subTitles: '*001*はじまりの旅\n*002*ふたつめの旅',
        }),
    ]);
    const { dictionary, db } = makeDictionary({ xml });

    const result = await dictionary.sync({ full: true });

    assert.equal(result.error, null);
    assert.equal(result.imported, 1);
    assert.equal(result.titleCount, 1);
    assert.equal(db.titles.get(1).title, 'ざつ旅-That’s Journey-');
    // SubTitles の最大話数が総話数として保存される (欠番検出の上限に使う)
    assert.equal(db.titles.get(1).totalEpisodes, 2);
    assert.ok(db.aliases.some(x => x.lookupKey === 'ざつ旅' && x.rank === 1));
});

test('sync() uses the stored lastUpdate as an incremental cursor on the second run', async () => {
    const requested = [];
    const xml = makeXml([titleItem({ tid: 1, title: '作品タイトル', lastUpdate: '2026-07-01 12:34:56' })]);
    const { dictionary } = makeDictionary({ xml, onRequest: url => requested.push(url) });

    await dictionary.sync({ full: true });
    await dictionary.sync();

    assert.equal(requested.length, 2);
    // 'LastUpdate' は Fields にも含まれるため、カーソル指定は 'LastUpdate=' の有無で判定する
    assert.equal(requested[0].includes('LastUpdate='), false);
    assert.ok(requested[1].includes('LastUpdate=20260701_123456-'), requested[1]);
});

test('sync() reports the error instead of throwing when the fetch fails', async () => {
    const { dictionary } = makeDictionary({
        xml: () => {
            throw new Error('network is down');
        },
    });

    const result = await dictionary.sync({ full: true });

    assert.equal(result.error, 'network is down');
    assert.equal(result.imported, 0);
    assert.equal(result.titleCount, 0);
});
