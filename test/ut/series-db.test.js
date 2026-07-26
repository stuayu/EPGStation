'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesDB = require('../../dist/model/db/SeriesDB').default;
const Series = require('../../dist/db/entities/Series').default;

/**
 * SeriesDB.ts (TypeORM Repository をラップした DB 層) を検証するための最小限のインメモリ TypeORM 互換フェイク
 * Like / Not / IsNull は実際の typeorm パッケージが返す FindOperator インスタンスなので、
 * その .type / .value を見て素朴に評価する
 */
function matchField(rowValue, criteria) {
    if (criteria !== null && typeof criteria === 'object' && criteria.constructor?.name === 'FindOperator') {
        switch (criteria.type) {
            case 'like': {
                const pattern = String(criteria.value).replace(/%/g, '');
                return typeof rowValue === 'string' && rowValue.includes(pattern);
            }
            case 'not':
                return rowValue !== criteria.value;
            case 'isNull':
                return rowValue === null || typeof rowValue === 'undefined';
            default:
                throw new Error(`unsupported fake FindOperator type: ${criteria.type}`);
        }
    }

    return rowValue === criteria;
}

function matchWhere(row, where) {
    if (typeof where === 'undefined') return true;
    if (Array.isArray(where)) return where.some(w => matchWhere(row, w));
    return Object.entries(where).every(([key, value]) => matchField(row[key], value));
}

function sortRows(rows, order) {
    if (!order) return rows;
    const [key, dir] = Object.entries(order)[0];
    return [...rows].sort((a, b) => {
        if (a[key] === b[key]) return 0;
        const cmp = a[key] > b[key] ? 1 : -1;
        return dir === 'ASC' ? cmp : -cmp;
    });
}

function makeStore() {
    return { rows: [], nextId: 1 };
}

function makeRepo(store) {
    return {
        create: value => ({ ...value }),
        find: async (opt = {}) => {
            let rows = store.rows.filter(r => matchWhere(r, opt.where));
            rows = sortRows(rows, opt.order);
            if (typeof opt.skip === 'number') rows = rows.slice(opt.skip);
            if (typeof opt.take === 'number') rows = rows.slice(0, opt.take);
            return rows;
        },
        findOne: async (opt = {}) => {
            const rows = sortRows(
                store.rows.filter(r => matchWhere(r, opt.where)),
                opt.order,
            );
            return rows[0] ?? null;
        },
        findAndCount: async (opt = {}) => {
            let rows = store.rows.filter(r => matchWhere(r, opt.where));
            const total = rows.length;
            rows = sortRows(rows, opt.order);
            if (typeof opt.skip === 'number') rows = rows.slice(opt.skip);
            if (typeof opt.take === 'number') rows = rows.slice(0, opt.take);
            return [rows, total];
        },
        save: async value => {
            if (typeof value.id === 'number') {
                const idx = store.rows.findIndex(r => r.id === value.id);
                if (idx >= 0) {
                    store.rows[idx] = { ...store.rows[idx], ...value };
                    return store.rows[idx];
                }
            }
            const saved = { ...value, id: value.id ?? store.nextId++ };
            store.rows.push(saved);
            return saved;
        },
        delete: async where => {
            const before = store.rows.length;
            store.rows = store.rows.filter(r => !matchWhere(r, where));
            return { affected: before - store.rows.length };
        },
        update: async (where, patch) => {
            let affected = 0;
            for (const row of store.rows) {
                if (matchWhere(row, where)) {
                    Object.assign(row, patch);
                    affected++;
                }
            }
            return { affected };
        },
        count: async (opt = {}) => store.rows.filter(r => matchWhere(r, opt.where)).length,
    };
}

function makeConnection() {
    const stores = new Map();
    const storeFor = Entity => {
        if (!stores.has(Entity)) stores.set(Entity, makeStore());
        return stores.get(Entity);
    };
    const manager = { getRepository: Entity => makeRepo(storeFor(Entity)) };

    return {
        stores,
        storeFor,
        getRepository: Entity => makeRepo(storeFor(Entity)),
        transaction: async cb => cb(manager),
        createQueryRunner: () => ({
            manager: {
                createQueryBuilder: () => ({
                    delete: () => ({
                        from: Entity => ({
                            execute: async () => {
                                storeFor(Entity).rows = [];
                            },
                        }),
                    }),
                }),
                insert: async (Entity, item) => {
                    storeFor(Entity).rows.push({ ...item });
                },
            },
            startTransaction: async () => {},
            commitTransaction: async () => {},
            rollbackTransaction: async () => {},
            release: async () => {},
        }),
    };
}

function makeDB() {
    const connection = makeConnection();
    const op = { getConnection: async () => connection };
    return { db: new SeriesDB(op), connection };
}

test('findCandidates: exact match takes priority over prefix match', async () => {
    const { db, connection } = makeDB();
    connection.storeFor(Series).rows.push(
        { id: 1, title: 'A', normalizedTitle: 'アニメa', createdAt: 1, updatedAt: 1 },
        { id: 2, title: 'B', normalizedTitle: 'アニメaその2', createdAt: 1, updatedAt: 1 },
    );

    const exact = await db.findCandidates('アニメa');
    assert.equal(exact.length, 1);
    assert.equal(exact[0].id, 1);

    // 完全一致が無い場合は先頭 4 文字を含む緩い絞り込みになるため、両方の候補が返る
    // (最終的な絞り込みは SeriesResolver 側のスコアリングに委ねる設計)
    const broad = await db.findCandidates('アニメaZ');
    assert.equal(broad.length, 2);

    assert.deepEqual(await db.findCandidates(''), []);
});

test('createSeries persists a new row via repo.save', async () => {
    const { db } = makeDB();
    const created = await db.createSeries({
        title: 'T',
        normalizedTitle: 't',
        preferredChannelId: null,
        createdAt: 1,
        updatedAt: 1,
    });
    assert.equal(created.title, 'T');
    assert.equal(typeof created.id, 'number');
});

test('findEpisode returns null when episodeNumber is null, and creates/looks up otherwise', async () => {
    const { db } = makeDB();
    assert.equal(await db.findEpisode(1, 1, null), null);

    const created = await db.createEpisode({
        seriesId: 1,
        seasonNumber: 1,
        episodeNumber: 3,
        episodeLabel: '第3話',
        title: null,
        airedAt: 100,
        createdAt: 1,
        updatedAt: 1,
    });
    const found = await db.findEpisode(1, 1, 3);
    assert.equal(found.id, created.id);
    assert.equal(await db.findEpisodeById(created.id).then(x => x.id), created.id);
    assert.equal(await db.findEpisodeById(9999), null);
});

test('findLink / saveLink: create then update in place (does not duplicate rows)', async () => {
    const { db } = makeDB();
    assert.equal(await db.findLink(1), null);

    const created = await db.saveLink({
        recordedId: 1,
        seriesId: 10,
        channelId: 5,
        episodeId: null,
        airType: 'unknown',
        matchMethod: 'title',
        confidence: 0.9,
        manualLock: false,
        createdAt: 100,
        updatedAt: 100,
    });
    assert.equal(created.recordedId, 1);

    const updated = await db.saveLink({
        recordedId: 1,
        seriesId: 10,
        channelId: 5,
        episodeId: 2,
        airType: 'first',
        matchMethod: 'title',
        confidence: 1,
        manualLock: false,
        createdAt: 999, // saveLink はレコードが既にあれば元の createdAt を維持する
        updatedAt: 200,
    });
    assert.equal(updated.episodeId, 2);
    assert.equal(updated.createdAt, 100);

    const link = await db.findLink(1);
    assert.equal(link.episodeId, 2);
});

test('list: filters by keyword across title/normalizedTitle and paginates', async () => {
    const { db, connection } = makeDB();
    connection.storeFor(Series).rows.push(
        { id: 1, title: 'アニメA', normalizedTitle: 'アニメa', updatedAt: 3 },
        { id: 2, title: 'ドラマB', normalizedTitle: 'ドラマb', updatedAt: 2 },
        { id: 3, title: 'アニメC', normalizedTitle: 'アニメc', updatedAt: 1 },
    );

    const [all, allTotal] = await db.list(undefined, 0, 10);
    assert.equal(allTotal, 3);
    assert.equal(all.length, 3);

    const [filtered, filteredTotal] = await db.list('アニメ', 0, 10);
    assert.equal(filteredTotal, 2);
    assert.ok(filtered.every(s => s.title.includes('アニメ')));

    const [paged] = await db.list(undefined, 1, 1);
    assert.equal(paged.length, 1);
});

test('getSeries / deleteLink / countOtherLinksByEpisode / updateExternalMetadata', async () => {
    const { db, connection } = makeDB();
    connection.storeFor(Series).rows.push({ id: 1, title: 'A', normalizedTitle: 'a', updatedAt: 1 });
    assert.equal((await db.getSeries(1)).id, 1);
    assert.equal(await db.getSeries(404), null);

    await db.saveLink({
        recordedId: 1,
        seriesId: 1,
        channelId: 1,
        episodeId: 5,
        airType: 'first',
        matchMethod: 'title',
        confidence: 1,
        manualLock: false,
        createdAt: 1,
        updatedAt: 1,
    });
    await db.saveLink({
        recordedId: 2,
        seriesId: 1,
        channelId: 1,
        episodeId: 5,
        airType: 'rerun',
        matchMethod: 'title',
        confidence: 1,
        manualLock: false,
        createdAt: 1,
        updatedAt: 1,
    });
    assert.equal(await db.countOtherLinksByEpisode(5, 2), 1);

    await db.deleteLink(1);
    assert.equal(await db.findLink(1), null);
    assert.equal(await db.countOtherLinksByEpisode(5, 2), 0);

    await db.updateExternalMetadata(1, { annictId: 'abc', syobocalTid: 42 });
    const series = await db.getSeries(1);
    assert.equal(series.annictId, 'abc');
    assert.equal(series.syobocalTid, 42);
});

test('pending match queue: upsert is keyed by recordedId, list/get/find/delete work', async () => {
    const { db } = makeDB();
    const first = await db.upsertPendingMatch({
        recordedId: 1,
        normalizedTitle: 'a',
        channelId: 1,
        candidates: [{ seriesId: 1, seriesTitle: 'A', score: 0.5 }],
        createdAt: 100,
    });
    const second = await db.upsertPendingMatch({
        recordedId: 1,
        normalizedTitle: 'a2',
        channelId: 1,
        candidates: [],
        createdAt: 999,
    });
    assert.equal(second.id, first.id);
    assert.equal(second.createdAt, 100);

    const [list, total] = await db.listPendingMatches(0, 10);
    assert.equal(total, 1);
    assert.equal(list[0].normalizedTitle, 'a2');

    assert.equal((await db.getPendingMatch(first.id)).recordedId, 1);
    assert.equal((await db.findPendingMatchByRecordedId(1)).id, first.id);
    assert.equal(await db.findPendingMatchByRecordedId(999), null);

    await db.deletePendingMatchByRecordedId(1);
    assert.equal(await db.findPendingMatchByRecordedId(1), null);

    const third = await db.upsertPendingMatch({
        recordedId: 2,
        normalizedTitle: 'b',
        channelId: 1,
        candidates: [],
        createdAt: 1,
    });
    await db.deletePendingMatch(third.id);
    assert.equal(await db.getPendingMatch(third.id), null);
});

test('parsePendingCandidates parses JSON arrays and falls back to [] on invalid input', () => {
    assert.deepEqual(SeriesDB.parsePendingCandidates('[{"seriesId":1,"seriesTitle":"A","score":0.5}]'), [
        { seriesId: 1, seriesTitle: 'A', score: 0.5 },
    ]);
    assert.deepEqual(SeriesDB.parsePendingCandidates('not json'), []);
    assert.deepEqual(SeriesDB.parsePendingCandidates('{"not":"an array"}'), []);
});

test('alias dictionary: upsert is keyed by normalizedTitle, list filters by seriesId', async () => {
    const { db } = makeDB();
    const created = await db.upsertAlias('a', 1, 100);
    const updated = await db.upsertAlias('a', 2, 999);
    assert.equal(updated.id, created.id);
    assert.equal(updated.seriesId, 2);
    assert.equal(updated.createdAt, 100);

    await db.upsertAlias('b', 3, 1);
    assert.equal((await db.listAlias()).length, 2);
    assert.equal((await db.listAlias(2)).length, 1);
    assert.equal((await db.findAlias('a')).seriesId, 2);
    assert.equal(await db.findAlias('missing'), null);

    await db.deleteAlias(created.id);
    assert.equal(await db.findAlias('a'), null);
});

test('change history: add / get / getLatestHistoryForRecorded / markHistoryUndone', async () => {
    const { db } = makeDB();
    const h1 = await db.addHistory({
        recordedId: 1,
        action: 'manual',
        previous: {
            seriesId: 10,
            episodeId: 20,
            airType: 'first',
            matchMethod: 'title',
            confidence: 1,
            manualLock: false,
        },
        createdAt: 100,
    });
    assert.equal(h1.previousSeriesId, 10);

    const h2 = await db.addHistory({ recordedId: 1, action: 'reject', previous: null, createdAt: 200 });
    assert.equal(h2.previousSeriesId, null);

    assert.equal((await db.getHistory(h1.id)).id, h1.id);
    assert.equal(await db.getHistory(9999), null);

    const latest = await db.getLatestHistoryForRecorded(1);
    assert.equal(latest.id, h2.id);

    await db.markHistoryUndone(h2.id);
    const afterUndo = await db.getLatestHistoryForRecorded(1);
    assert.equal(afterUndo.id, h1.id);
});

test('mergeSeries: no-op when ids are equal, otherwise moves links/episodes/aliases and deletes the source series', async () => {
    const { db, connection } = makeDB();
    assert.equal(await db.mergeSeries(1, 1), 0);

    connection.storeFor(Series).rows.push(
        { id: 1, title: 'From', normalizedTitle: 'from', updatedAt: 1 },
        { id: 2, title: 'To', normalizedTitle: 'to', updatedAt: 1 },
    );
    const ep = await db.createEpisode({
        seriesId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
        episodeLabel: '第1話',
        title: null,
        airedAt: 1,
        createdAt: 1,
        updatedAt: 1,
    });
    await db.saveLink({
        recordedId: 1,
        seriesId: 1,
        channelId: 1,
        episodeId: ep.id,
        airType: 'first',
        matchMethod: 'title',
        confidence: 1,
        manualLock: false,
        createdAt: 1,
        updatedAt: 1,
    });
    await db.upsertAlias('from', 1, 1);

    const moved = await db.mergeSeries(1, 2);
    assert.equal(moved, 1);

    const link = await db.findLink(1);
    assert.equal(link.seriesId, 2);
    assert.notEqual(link.episodeId, ep.id); // 移行先に同一エピソードが無いので新規作成される

    assert.equal(await db.getSeries(1), null); // マージ元は削除される
    assert.equal((await db.findAlias('from')).seriesId, 2);
});

test('splitSeries: validates input, moves matching links to a brand new series, and locks them manually', async () => {
    const { db, connection } = makeDB();
    await assert.rejects(() => db.splitSeries(1, [], 'new'), /SplitTargetIsEmpty/);
    await assert.rejects(() => db.splitSeries(404, [1], 'new'), /SeriesIsNotFound/);

    connection.storeFor(Series).rows.push({
        id: 1,
        title: 'Source',
        normalizedTitle: 'source',
        mediaType: 'tv',
        updatedAt: 1,
    });
    await db.saveLink({
        recordedId: 1,
        seriesId: 1,
        channelId: 1,
        episodeId: 5,
        airType: 'first',
        matchMethod: 'title',
        confidence: 1,
        manualLock: false,
        createdAt: 1,
        updatedAt: 1,
    });

    const newSeries = await db.splitSeries(1, [1], 'New Series');
    assert.equal(newSeries.title, 'New Series');

    const link = await db.findLink(1);
    assert.equal(link.seriesId, newSeries.id);
    assert.equal(link.episodeId, null);
    assert.equal(link.manualLock, true);
    assert.equal(link.matchMethod, 'manual');
});

test('backup/restore helpers: findAll* returns all rows and restore* replaces the table contents', async () => {
    const { db, connection } = makeDB();
    connection.storeFor(Series).rows.push({ id: 1, title: 'A', normalizedTitle: 'a', updatedAt: 1 });
    assert.equal((await db.findAllSeries()).length, 1);
    assert.deepEqual(await db.findAllEpisodes(), []);
    assert.deepEqual(await db.findAllLinks(), []);
    assert.deepEqual(await db.findAllAliases(), []);
    assert.deepEqual(await db.findAllPendingMatches(), []);
    assert.deepEqual(await db.findAllHistories(), []);

    await db.restoreSeries([{ id: 5, title: 'restored', normalizedTitle: 'restored', updatedAt: 1 }]);
    const restoredSeries = await db.findAllSeries();
    assert.equal(restoredSeries.length, 1);
    assert.equal(restoredSeries[0].id, 5);

    await db.restoreEpisodes([]);
    await db.restoreLinks([]);
    await db.restoreAliases([]);
    await db.restorePendingMatches([]);
    await db.restoreHistories([]);
    assert.deepEqual(await db.findAllEpisodes(), []);
    assert.deepEqual(await db.findAllLinks(), []);
    assert.deepEqual(await db.findAllAliases(), []);
    assert.deepEqual(await db.findAllPendingMatches(), []);
    assert.deepEqual(await db.findAllHistories(), []);
});
