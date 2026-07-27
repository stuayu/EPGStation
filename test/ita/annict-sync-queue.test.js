'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const AnnictSyncQueueModel = require('../../dist/model/metadata/annict/AnnictSyncQueueModel').default;

/**
 * IAnnictWatchSyncDB のインメモリ実装 (AnnictWatchSyncDB.ts のロジックを忠実に再現)。
 * 「永続化」は実 sqlite の代わりに、このストアがモデルのインスタンスをまたいで
 * 生き残ること (プロセス再起動を模擬) で検証する
 */
function makeInMemoryQueueDB() {
    let nextId = 1;
    const rows = new Map();
    return {
        rows,
        enqueue: async value => {
            const current = [...rows.values()].find(
                x => x.seriesId === value.seriesId && x.seriesEpisodeId === value.seriesEpisodeId,
            );
            if (current) {
                if (current.status === 'sent') return current;
                current.status = 'pending';
                current.nextAttemptAt = value.now;
                current.annictWorkId = value.annictWorkId;
                current.episodeNumber = value.episodeNumber;
                return current;
            }
            const row = {
                id: nextId++,
                recordedId: value.recordedId,
                seriesId: value.seriesId,
                seriesEpisodeId: value.seriesEpisodeId,
                annictWorkId: value.annictWorkId,
                episodeNumber: value.episodeNumber,
                status: 'pending',
                attempts: 0,
                nextAttemptAt: value.now,
                lastError: null,
            };
            rows.set(row.id, row);
            return row;
        },
        findDue: async (now, limit) =>
            [...rows.values()]
                .filter(x => x.status === 'pending' && x.nextAttemptAt <= now)
                .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
                .slice(0, limit),
        markSent: async (id, now) => {
            const row = rows.get(id);
            row.status = 'sent';
            row.updatedAt = now;
        },
        markFailed: async (id, option) => {
            const row = rows.get(id);
            row.status = option.terminal ? 'failed' : 'pending';
            row.attempts = option.attempts;
            row.nextAttemptAt = option.nextAttemptAt;
            row.lastError = option.lastError;
        },
        findBySeriesId: async seriesId => [...rows.values()].filter(x => x.seriesId === seriesId),
    };
}

function makeSeriesDB({ episodeNumber = 1 } = {}) {
    const series = { id: 1, title: 'テスト作品', normalizedTitle: 'てすとさくひん', annictId: 'annict-1', syobocalTid: null };
    const episode = { id: 10, episodeNumber };
    return {
        findLink: async () => ({ seriesId: 1, episodeId: 10 }),
        getSeries: async id => (id === 1 ? series : null),
        findEpisodeById: async id => (id === 10 ? episode : null),
        listRecorded: async () => [{ recordedId: 1, episodeId: 10, episodeNumber }],
    };
}

const enabledConfig = { getConfig: () => ({ featureFlags: { metadataProviders: true, annictSync: true } }) };
function makeSettingsDB(syncEnabled = true) {
    return { getAll: async () => ({ metadata: { annict: { syncEnabled } } }) };
}

test('a pending row surviving a transient failure is persisted and picked up by a new model instance (simulated process restart)', async () => {
    const queueDB = makeInMemoryQueueDB();
    const seriesDB = makeSeriesDB();
    // model1 の存命中は Annict 側が落ちている想定 (視聴履歴の更新自体は失敗させない: 障害分離)
    const failingMetadata = {
        pushWatchRecord: async () => {
            throw new Error('AnnictHttpStatus:503');
        },
    };
    const model1 = new AnnictSyncQueueModel(enabledConfig, seriesDB, queueDB, failingMetadata, makeSettingsDB());
    model1.enqueueFromWatchHistory(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(queueDB.rows.size, 1);
    const row = [...queueDB.rows.values()][0];
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 1);
    row.nextAttemptAt = Date.now(); // バックオフ待ち時間の経過を模擬 (実時間は待たない)

    // 「プロセス再起動」を模擬: 同じ永続ストアを共有する新しいモデルインスタンスが引き継いで処理する
    const model2 = new AnnictSyncQueueModel(
        enabledConfig,
        seriesDB,
        queueDB,
        {
            pushWatchRecord: async () => ({ recordId: 'r1' }),
        },
        makeSettingsDB(),
    );
    const result = await model2.processQueue();
    assert.equal(result.sent, 1);
    assert.equal([...queueDB.rows.values()][0].status, 'sent');
});

test('does not enqueue (no DB writes at all) when annictSync feature flag is disabled', async () => {
    const queueDB = makeInMemoryQueueDB();
    const seriesDB = makeSeriesDB();
    const disabledConfig = { getConfig: () => ({ featureFlags: { metadataProviders: true, annictSync: false } }) };
    const model = new AnnictSyncQueueModel(
        disabledConfig,
        seriesDB,
        queueDB,
        {
            pushWatchRecord: async () => {
                throw new Error('must not be called');
            },
        },
        makeSettingsDB(),
    );
    model.enqueueFromWatchHistory(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(queueDB.rows.size, 0);
});

test('the same episode is never sent twice (dedupe via seriesId+seriesEpisodeId)', async () => {
    const queueDB = makeInMemoryQueueDB();
    const seriesDB = makeSeriesDB();
    let calls = 0;
    const metadata = {
        pushWatchRecord: async () => {
            calls++;
            return { recordId: `r${calls}` };
        },
    };
    const model = new AnnictSyncQueueModel(enabledConfig, seriesDB, queueDB, metadata, makeSettingsDB());
    model.enqueueFromWatchHistory(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    // 再度 watched に遷移 (再視聴等) しても、既に送信済みのエピソードは再送されない
    model.enqueueFromWatchHistory(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 1);
    assert.equal(queueDB.rows.size, 1);
});

test('failed attempts back off exponentially and eventually become terminal after max attempts', async () => {
    const queueDB = makeInMemoryQueueDB();
    const seriesDB = makeSeriesDB();
    const metadata = {
        pushWatchRecord: async () => {
            throw new Error('AnnictEpisodeIsNotFound');
        },
    };
    const model = new AnnictSyncQueueModel(enabledConfig, seriesDB, queueDB, metadata, makeSettingsDB());
    await queueDB.enqueue({
        recordedId: 1,
        seriesId: 1,
        seriesEpisodeId: 10,
        annictWorkId: 'annict-1',
        episodeNumber: 1,
        now: Date.now(),
    });

    let previousDelay = 0;
    for (let i = 0; i < 8; i++) {
        const before = Date.now();
        // eslint-disable-next-line no-await-in-loop
        await model.processQueue();
        const row = [...queueDB.rows.values()][0];
        if (i < 7) {
            assert.equal(row.status, 'pending');
            const delay = row.nextAttemptAt - before;
            assert.ok(delay >= previousDelay, `delay should not shrink (attempt ${i})`);
            previousDelay = delay;
            row.nextAttemptAt = before; // 次のループで即時 due にする (テストなので実時間を待たない)
        } else {
            assert.equal(row.status, 'failed');
        }
    }
});

// 二重ゲート (§5.5・§6.2): featureFlags.annictSync が有効でも、設定画面 (DB) 側の
// syncEnabled が false なら同期は一切動作しない
test('double gate: does not enqueue when the feature flag is enabled but the DB syncEnabled toggle is off', async () => {
    const queueDB = makeInMemoryQueueDB();
    const seriesDB = makeSeriesDB();
    const model = new AnnictSyncQueueModel(
        enabledConfig,
        seriesDB,
        queueDB,
        {
            pushWatchRecord: async () => {
                throw new Error('must not be called');
            },
        },
        makeSettingsDB(false),
    );
    model.enqueueFromWatchHistory(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(queueDB.rows.size, 0);
});

// DB 側の値が未設定 (syncEnabled が undefined) の場合は、feature flag が有効な既存導入で
// アップグレード後に同期が急に止まらないよう既定 true として扱う
test('double gate: defaults to enabled when the DB syncEnabled value is not yet set', async () => {
    const queueDB = makeInMemoryQueueDB();
    const seriesDB = makeSeriesDB();
    const metadata = { pushWatchRecord: async () => ({ recordId: 'r1' }) };
    const model = new AnnictSyncQueueModel(enabledConfig, seriesDB, queueDB, metadata, { getAll: async () => ({}) });
    model.enqueueFromWatchHistory(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(queueDB.rows.size, 1);
    assert.equal([...queueDB.rows.values()][0].status, 'sent');
});

test('enqueueSeries queues all episode-linked recordings for manual re-sync and processes them', async () => {
    const queueDB = makeInMemoryQueueDB();
    const seriesDB = makeSeriesDB();
    const metadata = { pushWatchRecord: async () => ({ recordId: 'r1' }) };
    const model = new AnnictSyncQueueModel(enabledConfig, seriesDB, queueDB, metadata, makeSettingsDB());
    const result = await model.enqueueSeries(1);
    assert.equal(result.queued, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal([...queueDB.rows.values()][0].status, 'sent');
});
