'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const PendingModel = require('../../dist/model/api/series/SeriesPendingApiModel').default;
const MaintenanceModel = require('../../dist/model/api/series/SeriesMaintenanceApiModel').default;
const AliasModel = require('../../dist/model/api/series/SeriesAliasApiModel').default;
const config = { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) };
const disabledConfig = { getConfig: () => ({ featureFlags: { seriesLibrary: false } }) };

function pendingFixture() {
    const recorded = { id: 7, name: '作品 第1話', channelId: 10, startAt: 100 };
    const pending = {
        id: 1,
        recordedId: 7,
        normalizedTitle: '作品',
        channelId: 10,
        candidatesJson: JSON.stringify([{ seriesId: 2, seriesTitle: '作品', score: 0.5 }]),
        createdAt: 123,
    };
    const seriesDB = {
        listPendingMatches: async () => [[pending], 1],
        getPendingMatch: async id => (id === 1 ? pending : null),
        deletePendingMatch: async () => {},
    };
    const mappingApiModel = {
        update: async (recordedId, option) => ({ recordedId, seriesId: option.seriesId, manualLock: true }),
    };
    return {
        model: new PendingModel(config, { findId: async () => recorded }, seriesDB, mappingApiModel),
    };
}

test('pending queue lists items with recorded title and parsed candidates', async () => {
    const { model } = pendingFixture();
    const result = await model.list(0, 30);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].recordedTitle, '作品 第1話');
    assert.equal(result.items[0].candidates[0].seriesId, 2);
});
test('pending confirm delegates to mapping update using the pending recordedId', async () => {
    const { model } = pendingFixture();
    const result = await model.confirm(1, { seriesId: 2 });
    assert.equal(result.recordedId, 7);
    assert.equal(result.seriesId, 2);
});
test('pending confirm throws when the pending row is gone', async () => {
    const { model } = pendingFixture();
    await assert.rejects(() => model.confirm(999, {}), /PendingMatchIsNotFound/);
});
test('pending queue is hidden while feature is disabled', async () => {
    const model = new PendingModel(disabledConfig, {}, {}, {});
    await assert.rejects(() => model.list(0, 10), /SeriesLibraryFeatureIsDisabled/);
});

function maintenanceFixture() {
    const seriesA = { id: 1, title: 'A', normalizedTitle: 'よふかしのうた', syobocalTid: null };
    const seriesB = { id: 2, title: 'B', normalizedTitle: 'よふかしのうた2期', syobocalTid: 5678 };
    const seriesC = { id: 3, title: 'C', normalizedTitle: 'よるのばけもの', syobocalTid: null };
    const merged = [];
    const db = {
        getSeries: async id => ({ 1: seriesA, 2: seriesB, 3: seriesC }[id] ?? null),
        mergeSeries: async (from, to) => {
            merged.push([from, to]);
            return 3;
        },
        splitSeries: async (sourceId, recordedIds, newTitle) => ({ id: 9, title: newTitle }),
        findByNormalizedTitlePrefix: async () => [seriesB, seriesC],
        listRecordedForSeriesIds: async ids => new Map(ids.map(id => [id, [{ recordedId: id * 10 }]])),
    };
    return { model: new MaintenanceModel(config, db), merged };
}
test('merge moves links from source to target series', async () => {
    const { model } = maintenanceFixture();
    const result = await model.merge([1], 2);
    assert.equal(result.movedLinkCount, 3);
    assert.equal(result.mergedSeriesCount, 1);
});
test('merge accepts multiple source series at once', async () => {
    const { model, merged } = maintenanceFixture();
    const result = await model.merge([1, 3], 2);
    assert.equal(result.mergedSeriesCount, 2);
    assert.equal(result.movedLinkCount, 6);
    assert.deepEqual(merged, [
        [1, 2],
        [3, 2],
    ]);
});
test('merge ignores the target and duplicates in the source list', async () => {
    const { model, merged } = maintenanceFixture();
    const result = await model.merge([1, 1, 2], 2);
    assert.equal(result.mergedSeriesCount, 1);
    assert.deepEqual(merged, [[1, 2]]);
});
test('merge rejects merging a series into itself', async () => {
    const { model } = maintenanceFixture();
    await assert.rejects(() => model.merge([1], 1), /InvalidRequestBody/);
});
test('merge rejects unknown series ids', async () => {
    const { model } = maintenanceFixture();
    await assert.rejects(() => model.merge([1], 999), /SeriesIsNotFound/);
});
test('merge candidates rank prefix matches above partial ones and expose the origin', async () => {
    const { model } = maintenanceFixture();
    const result = await model.listMergeCandidates(1);
    assert.equal(result.seriesId, 1);
    assert.equal(result.origin, 'local');
    // 「よふかしのうた2期」は前方一致、「よるのばけもの」は先頭 1 文字だけの部分一致
    assert.equal(result.candidates[0].seriesId, 2);
    assert.equal(result.candidates[0].matchType, 'prefix');
    // しょぼいカレンダーの TID を持つ側は辞書起点として返る (統合先の既定に使う)
    assert.equal(result.candidates[0].origin, 'dictionary');
    assert.equal(result.candidates[0].recordedCount, 1);
});
test('split creates a new series from the given recordings', async () => {
    const { model } = maintenanceFixture();
    const result = await model.split(1, [10, 11], '新シリーズ');
    assert.equal(result.seriesId, 9);
    assert.equal(result.title, '新シリーズ');
});
test('split rejects an empty recordedIds list', async () => {
    const { model } = maintenanceFixture();
    await assert.rejects(() => model.split(1, [], '新シリーズ'), /InvalidRequestBody/);
});

test('alias list enriches entries with series title and can be removed', async () => {
    const db = {
        listAlias: async () => [{ id: 1, normalizedTitle: '作品', seriesId: 2, createdAt: 1 }],
        getSeries: async id => (id === 2 ? { id: 2, title: '作品名' } : null),
        deleteAlias: async () => {},
    };
    const model = new AliasModel(config, db);
    const items = await model.list();
    assert.equal(items[0].seriesTitle, '作品名');
    await model.remove(1);
});

/**
 * LLM が誤学習した「正規化タイトル → シリーズ」を設定画面から直せるようにしたときのふるまい
 */
function aliasFixture() {
    const aliases = {
        1: { id: 1, normalizedTitle: 'あそビバ', seriesId: 2, source: 'llm', createdAt: 1 },
        2: { id: 2, normalizedTitle: 'てれびちゃん', seriesId: 2, source: 'llm', createdAt: 2 },
    };
    const series = {
        2: { id: 2, title: 'あそびにいくヨ!', normalizedTitle: 'あそびにいくよ' },
        3: { id: 3, title: 'あそビバ', normalizedTitle: 'あそビバ' },
    };
    const updated = [];
    const removed = [];
    let nextSeriesId = 10;
    const db = {
        listAlias: async () => Object.values(aliases),
        getAlias: async id => aliases[id] ?? null,
        getSeries: async id => series[id] ?? null,
        findCandidates: async normalizedTitle => Object.values(series).filter(s => s.normalizedTitle === normalizedTitle),
        createSeries: async v => {
            const created = { ...v, id: nextSeriesId++ };
            series[created.id] = created;
            return created;
        },
        updateAlias: async (id, seriesId, source) => {
            updated.push({ id, seriesId, source });
            aliases[id] = { ...aliases[id], seriesId, source };
            return aliases[id];
        },
        deleteAlias: async id => {
            removed.push(id);
            delete aliases[id];
        },
    };
    return { model: new AliasModel(config, db), updated, removed };
}

test('alias update repoints the rule and marks it as manual', async () => {
    const { model, updated } = aliasFixture();
    const item = await model.update(1, { seriesId: 3 });
    assert.equal(item.seriesId, 3);
    assert.equal(item.seriesTitle, 'あそビバ');
    // 誤学習の修正なので、以後の自動学習で上書きされないよう手動扱いにする
    assert.equal(item.source, 'manual');
    // 引き当てキーである正規化タイトルは変えない
    assert.equal(item.normalizedTitle, 'あそビバ');
    assert.deepEqual(updated, [{ id: 1, seriesId: 3, source: 'manual' }]);
});

test('alias update can create the destination series from a title', async () => {
    const { model } = aliasFixture();
    const item = await model.update(1, { seriesTitle: '新しい番組' });
    assert.equal(item.seriesTitle, '新しい番組');
    assert.equal(item.source, 'manual');
});

test('alias update reuses an existing series when the normalized title matches', async () => {
    const { model } = aliasFixture();
    const item = await model.update(1, { seriesTitle: 'あそビバ' });
    assert.equal(item.seriesId, 3);
});

test('alias update rejects unknown ids and empty destinations', async () => {
    const { model } = aliasFixture();
    await assert.rejects(() => model.update(999, { seriesId: 3 }), /SeriesAliasIsNotFound/);
    await assert.rejects(() => model.update(1, { seriesId: 999 }), /SeriesIsNotFound/);
    await assert.rejects(() => model.update(1, { seriesTitle: '   ' }), /InvalidRequestBody/);
});

test('alias bulk edit repoints and removes in one request', async () => {
    const { model, removed } = aliasFixture();
    const result = await model.updateBulk({
        items: [
            { aliasId: 1, seriesId: 3 },
            { aliasId: 2, remove: true },
        ],
    });
    assert.equal(result.updated, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(removed, [2]);
});

test('alias bulk edit reports per-row failures without aborting the rest', async () => {
    const { model } = aliasFixture();
    const result = await model.updateBulk({
        items: [
            { aliasId: 999, seriesId: 3 },
            { aliasId: 1, seriesId: 3 },
        ],
    });
    assert.equal(result.updated, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].aliasId, 999);
    assert.match(result.failed[0].message, /SeriesAliasIsNotFound/);
});

test('alias bulk edit rejects an invalid body', async () => {
    const { model } = aliasFixture();
    await assert.rejects(() => model.updateBulk({}), /InvalidRequestBody/);
    assert.deepEqual(await model.updateBulk({ items: [] }), { updated: 0, removed: 0, failed: [] });
});

function dictionaryFixture() {
    const works = [
        {
            syobocalTid: 555,
            annictId: 777,
            wikidataQid: null,
            tmdbId: null,
            title: '作品X',
            titleKana: 'さくひんえっくす',
            seasonYear: 2025,
            seasonName: 'SPRING',
            totalEpisodes: 12,
            matchType: 'exact',
            confidence: 1,
            source: 'syobocal',
        },
        {
            syobocalTid: null,
            annictId: null,
            wikidataQid: 'Q100',
            tmdbId: 42,
            title: '番組Y',
            titleKana: null,
            seasonYear: null,
            seasonName: null,
            totalEpisodes: null,
            matchType: 'contain',
            confidence: 0.95,
            source: 'wikidata',
        },
    ];
    // 作品X だけローカル登録済み
    const bySyobocalTid = new Map([[555, { id: 5, title: '作品X' }]]);
    const created = [];
    const db = {
        findBySyobocalTid: async tid => bySyobocalTid.get(tid) ?? null,
        findByAnnictId: async () => null,
        findByWikidataQid: async () => null,
        findCandidates: async () => [],
        createSeries: async value => {
            created.push(value);
            return { id: 900 + created.length, title: value.title };
        },
    };
    const dictionary = {
        search: async keyword => (keyword === 'ヒット無し' ? [] : works),
        findByIds: async ids =>
            works.find(
                w =>
                    (ids.syobocalTid !== null && w.syobocalTid === ids.syobocalTid) ||
                    (ids.annictId !== null && w.annictId === ids.annictId) ||
                    (ids.wikidataQid !== null && w.wikidataQid === ids.wikidataQid),
            ) ?? null,
    };
    return { model: new MaintenanceModel(config, db, undefined, dictionary), created };
}

test('dictionary search marks works that already exist as local series', async () => {
    const { model } = dictionaryFixture();
    const result = await model.searchDictionary('作品');
    assert.equal(result.total, 2);
    assert.equal(result.items[0].title, '作品X');
    assert.equal(result.items[0].source, 'syobocal');
    assert.equal(result.items[0].seriesId, 5);
    assert.equal(result.items[1].wikidataQid, 'Q100');
    assert.equal(result.items[1].seriesId, null);
});

test('dictionary search rejects an empty keyword', async () => {
    const { model } = dictionaryFixture();
    await assert.rejects(() => model.searchDictionary('   '), /InvalidRequestBody/);
});

test('dictionary create makes a new series carrying the dictionary metadata', async () => {
    const { model, created } = dictionaryFixture();
    const result = await model.createFromDictionary({ wikidataQid: 'Q100' });
    assert.equal(result.created, true);
    assert.equal(result.title, '番組Y');
    assert.equal(created.length, 1);
    assert.equal(created[0].wikidataQid, 'Q100');
    assert.equal(created[0].tmdbId, 42);
});

test('dictionary create reuses the series that already has the same external id', async () => {
    const { model, created } = dictionaryFixture();
    const result = await model.createFromDictionary({ syobocalTid: 555 });
    assert.deepEqual(result, { seriesId: 5, title: '作品X', created: false });
    assert.equal(created.length, 0);
});

test('dictionary create rejects an empty body and unknown works', async () => {
    const { model } = dictionaryFixture();
    await assert.rejects(() => model.createFromDictionary({}), /InvalidRequestBody/);
    await assert.rejects(() => model.createFromDictionary({ syobocalTid: 999 }), /DictionaryWorkIsNotFound/);
});

test('dictionary search is hidden while the series library feature is disabled', async () => {
    const model = new MaintenanceModel(disabledConfig, {}, undefined, {});
    await assert.rejects(() => model.searchDictionary('作品'), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.createFromDictionary({ syobocalTid: 1 }), /SeriesLibraryFeatureIsDisabled/);
});

function emptySeriesFixture() {
    const rows = [
        {
            series: { id: 11, title: '抜け殻A', normalizedTitle: 'a', syobocalTid: null, annictId: null, wikidataQid: null, seasonYear: null, seasonName: null, createdAt: 100, updatedAt: 200 },
            aliasCount: 2,
            episodeCount: 3,
        },
        {
            series: { id: 12, title: '抜け殻B', normalizedTitle: 'b', syobocalTid: 555, annictId: null, wikidataQid: null, seasonYear: 2025, seasonName: 'SPRING', createdAt: 110, updatedAt: 210 },
            aliasCount: 0,
            episodeCount: 0,
        },
    ];
    const deleted = [];
    const db = {
        listEmptySeries: async () => rows,
        deleteSeriesByIds: async ids => {
            deleted.push(...ids);
            return ids.length;
        },
    };
    return { model: new MaintenanceModel(config, db), deleted };
}

test('empty series list reports alias / episode counts and origin', async () => {
    const { model } = emptySeriesFixture();
    const result = await model.listEmpty();
    assert.equal(result.total, 2);
    assert.equal(result.items[0].seriesId, 11);
    assert.equal(result.items[0].origin, 'local');
    assert.equal(result.items[0].aliasCount, 2);
    assert.equal(result.items[1].origin, 'dictionary');
});

test('empty series delete removes every empty series when no ids are given', async () => {
    const { model, deleted } = emptySeriesFixture();
    const result = await model.deleteEmpty();
    assert.equal(result.deletedSeriesCount, 2);
    assert.equal(result.deletedAliasCount, 2);
    assert.equal(result.deletedEpisodeCount, 3);
    assert.deepEqual(deleted, [11, 12]);
});

test('empty series delete accepts a subset of ids', async () => {
    const { model, deleted } = emptySeriesFixture();
    const result = await model.deleteEmpty([12, 12]);
    assert.equal(result.deletedSeriesCount, 1);
    assert.deepEqual(deleted, [12]);
});

test('empty series delete refuses ids that still have recordings', async () => {
    const { model, deleted } = emptySeriesFixture();
    await assert.rejects(() => model.deleteEmpty([11, 99]), /SeriesIsNotEmpty/);
    assert.deepEqual(deleted, []);
});

test('empty series delete rejects an invalid body', async () => {
    const { model } = emptySeriesFixture();
    await assert.rejects(() => model.deleteEmpty([]), /InvalidRequestBody/);
    await assert.rejects(() => model.deleteEmpty(['x']), /InvalidRequestBody/);
});

test('empty series maintenance is hidden while the series library feature is disabled', async () => {
    const model = new MaintenanceModel(disabledConfig, {});
    await assert.rejects(() => model.listEmpty(), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.deleteEmpty(), /SeriesLibraryFeatureIsDisabled/);
});

test('alias editing is blocked while the series library feature is disabled', async () => {
    const model = new AliasModel(disabledConfig, {});
    await assert.rejects(() => model.update(1, { seriesId: 2 }), /SeriesLibraryFeatureIsDisabled/);
    await assert.rejects(() => model.updateBulk({ items: [] }), /SeriesLibraryFeatureIsDisabled/);
});

test('updateMetadata saves a manually edited series title as manual', async () => {
    const patches = [];
    const db = {
        getSeries: async () => ({ id: 1, title: '作品', titleSource: null }),
        updateExternalMetadata: async (id, patch) => patches.push({ id, patch }),
    };
    const model = new MaintenanceModel(config, db);
    await model.updateMetadata(1, { title: '  正しい作品名  ' });
    assert.deepEqual(patches[0], { id: 1, patch: { title: '正しい作品名', titleSource: 'manual' } });
});

test('updateMetadata clears the manual flag when the title is set to null', async () => {
    const patches = [];
    const db = {
        getSeries: async () => ({ id: 1, title: '手動名', titleSource: 'manual' }),
        updateExternalMetadata: async (id, patch) => patches.push({ id, patch }),
    };
    const model = new MaintenanceModel(config, db);
    await model.updateMetadata(1, { title: null });
    // 表示名はそのまま。次のメタデータ再取得で辞書名へ戻せるように出所だけ消す
    assert.deepEqual(patches[0], { id: 1, patch: { titleSource: null } });
});

test('updateMetadata rejects an empty series title', async () => {
    const db = { getSeries: async () => ({ id: 1, title: '作品' }), updateExternalMetadata: async () => {} };
    const model = new MaintenanceModel(config, db);
    await assert.rejects(() => model.updateMetadata(1, { title: '   ' }), /InvalidRequestBody/);
});
