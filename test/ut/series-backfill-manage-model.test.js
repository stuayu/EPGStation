'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesBackfillManageModel = require('../../dist/model/operator/series/SeriesBackfillManageModel').default;

const noopLogger = { system: { info: () => {}, warn: () => {}, error: () => {} } };
const logger = { getLogger: () => noopLogger };

const waitUntil = async predicate => {
    for (let i = 0; i < 400; i++) {
        if ((await predicate()) === true) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timeout waiting for condition');
};

function makeRecordedDB(rows, linkedIds = new Set()) {
    const filtered = (afterId, filter = {}) =>
        rows
            .filter(r => r.id > afterId)
            .filter(r => (typeof filter.minId === 'number' && filter.minId > 0 ? r.id >= filter.minId : true))
            .filter(r => (filter.onlyUnlinked === true ? linkedIds.has(r.id) === false : true))
            .sort((a, b) => a.id - b.id);

    return {
        findForSeriesBackfill: async (afterId, limit, filter) => filtered(afterId, filter).slice(0, limit),
        countForSeriesBackfill: async (afterId, filter) => filtered(afterId, filter).length,
        findSeriesBackfillFloorId: async count => {
            const sorted = [...rows].sort((a, b) => b.id - a.id).slice(0, count);
            return sorted.length === 0 ? 0 : sorted[sorted.length - 1].id;
        },
        findId: async recordedId => rows.find(r => r.id === recordedId) ?? null,
    };
}

function makeSeriesDB(overrides = {}) {
    return {
        findLink: async () => null,
        findPendingMatchByRecordedId: async () => null,
        findAlias: async () => null,
        getSeries: async () => null,
        findCandidates: async () => [],
        createSeries: async () => {
            throw new Error('createSeries should not be called');
        },
        saveLink: async () => {
            throw new Error('saveLink should not be called');
        },
        upsertPendingMatch: async () => {
            throw new Error('upsertPendingMatch should not be called');
        },
        ...overrides,
    };
}

function makeSettingsDB(seriesSetting = {}) {
    const store = {};
    return {
        getAll: async () => JSON.parse(JSON.stringify({ series: seriesSetting, ...store })),
        upsert: async values => {
            for (const [k, v] of Object.entries(values)) store[k] = JSON.parse(JSON.stringify(v));
        },
        _store: store,
    };
}

function makeResolver(resultByRecordedId = new Map(), throwFor = new Set()) {
    const calls = [];
    const resolver = {
        calls,
        resolve: async input => {
            calls.push(input.recordedId);
            if (throwFor.has(input.recordedId)) throw new Error('resolve failed');
            return resultByRecordedId.has(input.recordedId) ? resultByRecordedId.get(input.recordedId) : null;
        },
    };
    return resolver;
}

// しょぼいカレンダー作品辞書は既定で「該当なし」を返し、従来の類似度判定の挙動を検証できるようにする
function makeTitleDictionary(match = null) {
    return {
        sync: async () => ({ titleCount: 0, lastUpdate: null, lastSyncedAt: null, running: false, error: null, imported: 0, full: false }),
        startAutoSync: () => {},
        lookup: async () => match,
        lookupEpisodeNumber: async () => null,
        getStatus: async () => ({ titleCount: 0, lastUpdate: null, lastSyncedAt: null, running: false, error: null }),
    };
}
function makeModel({ rows, seriesDB, settingsDB, resolver, titleDictionary, linkedIds }) {
    return new SeriesBackfillManageModel(
        logger,
        makeRecordedDB(rows, linkedIds),
        seriesDB ?? makeSeriesDB(),
        settingsDB ?? makeSettingsDB(),
        resolver ?? makeResolver(),
        titleDictionary ?? makeTitleDictionary(),
    );
}

test('getStatus() returns idle state before start() is ever called', async () => {
    const model = makeModel({ rows: [] });
    const status = await model.getStatus();
    assert.equal(status.state, 'idle');
    assert.equal(status.total, 0);
    assert.equal(status.processed, 0);
});

test('processes recordings across multiple chunks and aggregates progress', async () => {
    const rows = [1, 2, 3, 4, 5].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const resultByRecordedId = new Map(rows.map(r => [r.id, { seriesId: 1, recordedId: r.id }]));
    const resolver = makeResolver(resultByRecordedId);
    const model = makeModel({ rows, resolver });

    const started = await model.start({ chunkSize: 2, intervalMs: 0 });
    assert.equal(started.state, 'running');

    await waitUntil(() => resolver.calls.length === 5);
    const status = await model.getStatus();
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const finalStatus = await model.getStatus();
    assert.equal(finalStatus.state, 'completed');
    assert.equal(finalStatus.processed, 5);
    assert.equal(finalStatus.linked, 5);
    assert.equal(finalStatus.total, 5);
    assert.equal(finalStatus.lastRecordedId, 5);
    assert.deepEqual(resolver.calls, [1, 2, 3, 4, 5]);
});

test('manualLock recordings are skipped without calling the resolver', async () => {
    const rows = [1, 2, 3].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const seriesDB = makeSeriesDB({
        findLink: async recordedId => (recordedId === 2 ? { manualLock: true, seriesId: 99 } : null),
    });
    const resolver = makeResolver(new Map(rows.map(r => [r.id, { seriesId: 1, recordedId: r.id }])));
    const model = makeModel({ rows, seriesDB, resolver });

    await model.start({ chunkSize: 10, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const status = await model.getStatus();
    assert.equal(status.skipped, 1);
    assert.equal(status.linked, 2);
    assert.deepEqual(resolver.calls, [1, 3]);
});

test('recordings that fail to resolve are pending or failed and do not stop the batch', async () => {
    const rows = [1, 2, 3].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const seriesDB = makeSeriesDB({
        findPendingMatchByRecordedId: async recordedId => (recordedId === 2 ? { id: 1, recordedId } : null),
    });
    // recordedId 1 -> linked, 2 -> pending (resolver returns null and a pending row exists), 3 -> throws (failed)
    const resolver = makeResolver(new Map([[1, { seriesId: 1, recordedId: 1 }]]), new Set([3]));
    const model = makeModel({ rows, seriesDB, resolver });

    await model.start({ chunkSize: 10, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const status = await model.getStatus();
    assert.equal(status.linked, 1);
    assert.equal(status.pending, 1);
    assert.equal(status.failed, 1);
    assert.equal(status.processed, 3);
});

test('dry run never writes to the DB and returns a preview without touching the real cursor', async () => {
    const rows = [1, 2].map(id => ({ id, name: `新番組${id}`, channelId: 10, startAt: id * 1000 }));
    const seriesDB = makeSeriesDB();
    const resolver = makeResolver();
    const model = makeModel({ rows, seriesDB, resolver });

    const result = await model.start({ dryRun: true, chunkSize: 10, intervalMs: 0 });
    assert.equal(result.dryRun, true);
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const status = await model.getStatus();
    assert.equal(status.dryRun, true);
    assert.equal(status.processed, 2);
    // 候補が無い新規タイトルなので matched: true (新規シリーズ作成予定) として扱われる
    assert.equal(status.linked, 2);
    assert.ok(Array.isArray(status.previewItems));
    assert.equal(status.previewItems.length, 2);
    assert.equal(status.previewItems[0].seriesId, null);
    // ドライランは SeriesResolver.resolve() を一切呼ばない (DB へ書き込む経路を通らない)
    assert.equal(resolver.calls.length, 0);

    // ドライランは実バックフィルの再開カーソルに影響しない
    const realStatusAfterDryRun = { ...(await model.getStatus()) };
    assert.equal(realStatusAfterDryRun.lastRecordedId, 2); // これはドライランのカーソル (dryRun スロット)

    // 続けて実行 (dryRun ではない) すると、実カーソルは 0 のまま新規に開始される
    const realResult = await model.start({ chunkSize: 10, intervalMs: 0 });
    assert.equal(realResult.dryRun, false);
    assert.equal(realResult.lastRecordedId, 0);
    await waitUntil(async () => (await model.getStatus()).state === 'completed');
    const finalReal = await model.getStatus();
    assert.equal(finalReal.dryRun, false);
    assert.equal(finalReal.processed, 2);
});

test('start() while already running just returns the current status without starting a second job', async () => {
    const rows = [1, 2, 3].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const resolver = makeResolver(new Map(rows.map(r => [r.id, { seriesId: 1, recordedId: r.id }])));
    const model = makeModel({ rows, resolver });

    await model.start({ chunkSize: 1, intervalMs: 50 });
    const second = await model.start({ chunkSize: 1, intervalMs: 50 });
    assert.equal(second.state, 'running');

    await waitUntil(async () => (await model.getStatus()).state === 'completed');
    assert.equal((await model.getStatus()).processed, 3);
});

test('cancel() stops the batch and a later start() resumes from the last processed recordedId', async () => {
    const rows = [1, 2, 3, 4].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const settingsDB = makeSettingsDB();
    const resolver = makeResolver(new Map(rows.map(r => [r.id, { seriesId: 1, recordedId: r.id }])));
    const model = makeModel({ rows, settingsDB, resolver });

    await model.start({ chunkSize: 1, intervalMs: 100 });
    await waitUntil(() => resolver.calls.length >= 1);
    await model.cancel();
    await waitUntil(async () => (await model.getStatus()).state === 'canceled');

    const canceledStatus = await model.getStatus();
    assert.ok(canceledStatus.lastRecordedId >= 1);
    assert.ok(canceledStatus.lastRecordedId < 4);
    const processedBeforeResume = canceledStatus.processed;
    const callsBeforeResume = resolver.calls.length;

    await model.start({ chunkSize: 1, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const finalStatus = await model.getStatus();
    assert.equal(finalStatus.processed, 4);
    assert.equal(finalStatus.lastRecordedId, 4);
    // 既に処理済みだった recordedId は再度 resolve() されない (再開は続きから)
    assert.equal(resolver.calls.length, callsBeforeResume + (4 - processedBeforeResume));
    const uniqueCalls = new Set(resolver.calls);
    assert.equal(uniqueCalls.size, resolver.calls.length);
});

test('a persisted state left as running (simulating a crash) is treated as canceled and resumable', async () => {
    const rows = [1, 2, 3].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const settingsDB = makeSettingsDB();
    await settingsDB.upsert({
        seriesBackfill: {
            state: 'running',
            dryRun: false,
            total: 3,
            processed: 1,
            linked: 1,
            pending: 0,
            skipped: 0,
            failed: 0,
            startedAt: 1,
            finishedAt: null,
            lastRecordedId: 1,
            error: null,
        },
    });

    const resolver = makeResolver(new Map(rows.map(r => [r.id, { seriesId: 1, recordedId: r.id }])));
    const model = makeModel({ rows, settingsDB, resolver });

    const status = await model.getStatus();
    assert.equal(status.state, 'canceled');
    assert.equal(status.lastRecordedId, 1);

    await model.start({ chunkSize: 10, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const finalStatus = await model.getStatus();
    assert.equal(finalStatus.lastRecordedId, 3);
    // recordedId=1 は既に処理済みの前提だったので再度 resolve() されない
    assert.deepEqual(resolver.calls, [2, 3]);
    assert.equal(finalStatus.processed, 1 + 2);
});

test('dry run simulates series that would be created earlier in the same run', async () => {
    const rows = [
        { id: 1, name: 'CLANNAD AFTER STORY(HDマスター版) #16', channelId: 10, startAt: 1000 },
        { id: 2, name: 'CLANNAD AFTER STORY(HDマスター版) #17', channelId: 10, startAt: 2000 },
    ];
    const model = makeModel({ rows });

    await model.start({ dryRun: true, chunkSize: 10, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const status = await model.getStatus();
    assert.equal(status.linked, 2);
    assert.equal(status.previewItems[0].matched, true);
    assert.equal(status.previewItems[0].seriesId, null);
    assert.equal(status.previewItems[0].seriesTitle, 'CLANNAD AFTER STORY(HDマスター版)');
    assert.equal(status.previewItems[1].matched, true);
    assert.equal(status.previewItems[1].seriesId, null);
    assert.equal(status.previewItems[1].seriesTitle, 'CLANNAD AFTER STORY(HDマスター版)');
    assert.equal(status.previewItems[1].confidence, 1);
});

test('dry run lists a would-be-created series as a pending candidate with seriesId null', async () => {
    const rows = [
        { id: 1, name: '作品タイトル 第1話', channelId: 10, startAt: 1000 },
        { id: 2, name: '作品タイトル外伝 第1話', channelId: 10, startAt: 2000 },
    ];
    const settingsDB = makeSettingsDB({ matchThreshold: 0.99 });
    const model = makeModel({ rows, settingsDB });

    await model.start({ dryRun: true, chunkSize: 10, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const status = await model.getStatus();
    assert.equal(status.linked, 1);
    assert.equal(status.pending, 1);
    const pendingItem = status.previewItems[1];
    assert.equal(pendingItem.matched, false);
    assert.equal(pendingItem.candidates.length, 1);
    assert.equal(pendingItem.candidates[0].seriesId, null);
    assert.equal(pendingItem.candidates[0].seriesTitle, '作品タイトル');
});

test('onlyUnlinked filters out recordings that are already linked to a series', async () => {
    const rows = [1, 2, 3].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const resolver = makeResolver(new Map(rows.map(r => [r.id, { seriesId: 1, recordedId: r.id }])));
    const model = makeModel({ rows, resolver, linkedIds: new Set([2]) });

    await model.start({ onlyUnlinked: true, chunkSize: 10, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const status = await model.getStatus();
    assert.deepEqual(resolver.calls, [1, 3]);
    assert.equal(status.processed, 2);
    assert.equal(status.onlyUnlinked, true);
});

test('latest limits the run to the newest N recordings without moving the persisted cursor', async () => {
    const rows = [1, 2, 3, 4, 5].map(id => ({ id, name: `title${id}`, channelId: 10, startAt: id * 1000 }));
    const settingsDB = makeSettingsDB();
    const resolver = makeResolver(new Map(rows.map(r => [r.id, { seriesId: 1, recordedId: r.id }])));
    const model = makeModel({ rows, settingsDB, resolver });

    await model.start({ latest: 2, chunkSize: 10, intervalMs: 0 });
    await waitUntil(async () => (await model.getStatus()).state === 'completed');

    const status = await model.getStatus();
    assert.deepEqual(resolver.calls, [4, 5]);
    assert.equal(status.processed, 2);
    assert.equal(status.latest, 2);
    // 部分実行なので全件バックフィルの再開位置 (永続化された状態) は据え置き
    assert.equal(settingsDB._store.seriesBackfill, undefined);
});

test('analyze() resolves a single recording and returns the trace collected by the resolver', async () => {
    const rows = [{ id: 7, name: 'アニメA 第3話', channelId: 10, startAt: 7000 }];
    const seriesDB = makeSeriesDB({
        getSeries: async id => ({ id, title: 'アニメA' }),
        findEpisodeById: async id => ({ id, episodeNumber: 3, title: 'サブタイトル' }),
    });
    const resolver = {
        calls: [],
        resolve: async (input, trace) => {
            resolver.calls.push(input.recordedId);
            trace.push({ step: 'programLookup', label: '放送予定照会', input: 'ch=10', output: 'TID=1', matched: true });
            return {
                recordedId: input.recordedId,
                seriesId: 5,
                episodeId: 9,
                airType: 'first',
                matchMethod: 'syobocal',
                confidence: 0.98,
                manualLock: false,
            };
        },
    };
    const model = makeModel({ rows, seriesDB, resolver });

    const result = await model.analyze(7);
    assert.equal(result.recordedId, 7);
    assert.equal(result.linked, true);
    assert.equal(result.seriesId, 5);
    assert.equal(result.seriesTitle, 'アニメA');
    assert.equal(result.episodeNumber, 3);
    assert.equal(result.episodeTitle, 'サブタイトル');
    assert.equal(result.matchMethod, 'syobocal');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].step, 'programLookup');
});

test('analyze() throws for an unknown recordedId', async () => {
    const model = makeModel({ rows: [] });
    await assert.rejects(() => model.analyze(999), /RecordedIsNotFound/);
});
