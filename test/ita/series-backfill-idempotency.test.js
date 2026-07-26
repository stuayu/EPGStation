'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesBackfillManageModel = require('../../dist/model/operator/series/SeriesBackfillManageModel').default;
const SeriesResolver = require('../../dist/model/series/SeriesResolver').default;

const waitUntil = async predicate => {
    for (let i = 0; i < 400; i++) {
        if ((await predicate()) === true) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timeout waiting for condition');
};

const noopLogger = { system: { info: () => {}, warn: () => {}, error: () => {} } };
const logger = { getLogger: () => noopLogger };

/**
 * SeriesResolver が期待する ISeriesDB / IAppSettingDB の最小限のインメモリ実装
 * (series-resolver.test.js のメモリ実装を、複数シリーズ・複数エピソードを扱えるよう拡張したもの)
 */
function makeInMemorySeriesDB() {
    let nextSeriesId = 1;
    let nextEpisodeId = 1;
    const series = new Map();
    const episodes = [];
    const links = new Map();
    const pendingMatches = new Map();
    const aliases = new Map();

    return {
        series,
        episodes,
        links,
        pendingMatches,

        // 実装 (SeriesDB.findCandidates) と同様に、完全一致優先 → 先頭数文字の部分一致 で絞り込む
        findCandidates: async normalizedTitle => {
            const exact = [...series.values()].filter(s => s.normalizedTitle === normalizedTitle);
            if (exact.length > 0) return exact;
            const key = normalizedTitle.slice(0, Math.min(4, normalizedTitle.length));
            return key ? [...series.values()].filter(s => s.normalizedTitle.includes(key)) : [];
        },
        createSeries: async value => {
            const created = { ...value, id: nextSeriesId++ };
            series.set(created.id, created);
            return created;
        },
        getSeries: async id => series.get(id) ?? null,
        findEpisode: async (seriesId, seasonNumber, episodeNumber) =>
            episodes.find(
                e => e.seriesId === seriesId && e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber,
            ) ?? null,
        findEpisodeById: async id => episodes.find(e => e.id === id) ?? null,
        createEpisode: async value => {
            const created = { ...value, id: nextEpisodeId++ };
            episodes.push(created);
            return created;
        },
        findLink: async recordedId => links.get(recordedId) ?? null,
        saveLink: async value => {
            const current = links.get(value.recordedId);
            const saved = { ...current, ...value, id: current?.id ?? value.recordedId };
            links.set(value.recordedId, saved);
            return saved;
        },
        deleteLink: async recordedId => {
            links.delete(recordedId);
        },
        countOtherLinksByEpisode: async (episodeId, recordedId) =>
            [...links.values()].filter(l => l.episodeId === episodeId && l.recordedId !== recordedId).length,
        findAlias: async normalizedTitle => aliases.get(normalizedTitle) ?? null,
        upsertPendingMatch: async value => {
            const saved = { ...value, id: pendingMatches.get(value.recordedId)?.id ?? value.recordedId };
            pendingMatches.set(value.recordedId, saved);
            return saved;
        },
        findPendingMatchByRecordedId: async recordedId => pendingMatches.get(recordedId) ?? null,
        deletePendingMatchByRecordedId: async recordedId => {
            pendingMatches.delete(recordedId);
        },
    };
}

function makeSettingsDB() {
    const store = {};
    return {
        getAll: async () => JSON.parse(JSON.stringify({ series: { matchThreshold: 0.8 }, ...store })),
        upsert: async values => {
            for (const [k, v] of Object.entries(values)) store[k] = JSON.parse(JSON.stringify(v));
        },
    };
}

function makeRecordedDB(rows) {
    return {
        findForSeriesBackfill: async (afterId, limit) =>
            rows
                .filter(r => r.id > afterId)
                .sort((a, b) => a.id - b.id)
                .slice(0, limit),
        countForSeriesBackfill: async afterId => rows.filter(r => r.id > afterId).length,
    };
}

const config = { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) };

// 実行時刻 (createdAt/updatedAt) は実行タイミングによって変わるため、構造の比較からは除外する
function stripTimestamps(value) {
    const { createdAt, updatedAt, ...rest } = value;
    return rest;
}

function snapshot(seriesDB) {
    return JSON.stringify({
        series: [...seriesDB.series.values()].sort((a, b) => a.id - b.id).map(stripTimestamps),
        episodes: [...seriesDB.episodes].sort((a, b) => a.id - b.id).map(stripTimestamps),
        links: [...seriesDB.links.values()].sort((a, b) => a.recordedId - b.recordedId).map(stripTimestamps),
        pendingMatches: [...seriesDB.pendingMatches.values()]
            .sort((a, b) => a.recordedId - b.recordedId)
            .map(stripTimestamps),
    });
}

test('running the backfill twice over the same recordings does not change the resulting series state (idempotency, 提案書 §11.4)', async () => {
    // 同一エピソードへ複数録画が紐づくケース (再放送判定) は既存の SeriesResolver 自体が
    // 「その時点で他にリンク済みの録画が何件あるか」という履歴依存の判定 (§4 airType) を行うため、
    // 処理順序が変わると同一録画の airType (first/rerun) が変わり得る。これは本タスクで検証したい
    // バックフィル自体の冪等性 (重複してシリーズ/リンク/未確定行を作らないこと) とは別の話であり、
    // 既存 SeriesResolver の挙動を変更してはならないため、ここでは 1 エピソード 1 録画に限定して検証する
    const rows = [
        { id: 1, name: 'アニメA 第1話', channelId: 10, startAt: 1000 },
        { id: 2, name: 'アニメA 第2話', channelId: 10, startAt: 2000 },
        { id: 3, name: '全く別の番組', channelId: 30, startAt: 3000 },
        { id: 4, name: 'アニメA 第3話', channelId: 10, startAt: 4000 },
        // "アニメA" と先頭 4 文字は一致する (候補には挙がる) が全体の類似度がしきい値未満のため
        // 未確定キューへ積まれるケース
        { id: 5, name: 'アニメAスペシャル総集編2024', channelId: 99, startAt: 5000 },
    ];

    const seriesDB = makeInMemorySeriesDB();
    const settingsDB = makeSettingsDB();
    const recordedDB = makeRecordedDB(rows);
    const resolver = new SeriesResolver(config, settingsDB, seriesDB, { dispatch: async () => {} });

    // 1 回目の実行
    const modelA = new SeriesBackfillManageModel(logger, recordedDB, seriesDB, settingsDB, resolver);
    await modelA.start({ chunkSize: 2, intervalMs: 0 });
    await waitUntil(async () => (await modelA.getStatus()).state === 'completed');
    const statusA = await modelA.getStatus();
    const snapshotA = snapshot(seriesDB);

    assert.equal(statusA.processed, 5);
    assert.equal(statusA.failed, 0);
    // 新規タイトルが 2 種類 (アニメA / 全く別の番組) なので 2 シリーズ作成される
    assert.equal(seriesDB.series.size, 2);
    // アニメAX (id=5) は類似度不足で未確定キューへ積まれ、残り 4 件がリンクされる
    assert.equal(seriesDB.links.size, 4);
    assert.equal(seriesDB.pendingMatches.size, 1);
    assert.ok(seriesDB.pendingMatches.has(5));

    // 2 回目の実行: 同じ録画集合に対してカーソルを 0 に戻して再度バックフィルする
    // (中断・再開が自由 = 何度実行しても同じ結果になる、という冪等性の検証)
    const settingsDB2 = makeSettingsDB();
    const modelB = new SeriesBackfillManageModel(logger, recordedDB, seriesDB, settingsDB2, resolver);
    await modelB.start({ chunkSize: 2, intervalMs: 0 });
    await waitUntil(async () => (await modelB.getStatus()).state === 'completed');
    const statusB = await modelB.getStatus();
    const snapshotB = snapshot(seriesDB);

    assert.equal(statusB.processed, 5);
    assert.equal(statusB.failed, 0);
    // 2 回目の実行後もシリーズ・リンク・未確定件数は変化しない (重複作成されない)
    assert.equal(seriesDB.series.size, 2);
    assert.equal(seriesDB.links.size, 4);
    assert.equal(seriesDB.pendingMatches.size, 1);
    assert.equal(snapshotA, snapshotB);
});

test('running the backfill independently over two identical empty datasets produces the same deterministic result', async () => {
    const makeRows = () => [
        { id: 1, name: '番組X', channelId: 1, startAt: 1000 },
        { id: 2, name: '番組X 第2話', channelId: 1, startAt: 2000 },
        { id: 3, name: '番組Y', channelId: 2, startAt: 3000 },
    ];

    async function run() {
        const seriesDB = makeInMemorySeriesDB();
        const settingsDB = makeSettingsDB();
        const recordedDB = makeRecordedDB(makeRows());
        const resolver = new SeriesResolver(config, settingsDB, seriesDB, { dispatch: async () => {} });
        const model = new SeriesBackfillManageModel(logger, recordedDB, seriesDB, settingsDB, resolver);
        await model.start({ chunkSize: 1, intervalMs: 0 });
        await waitUntil(async () => (await model.getStatus()).state === 'completed');
        return snapshot(seriesDB);
    }

    const [snapshot1, snapshot2] = await Promise.all([run(), run()]);
    assert.equal(snapshot1, snapshot2);
});
