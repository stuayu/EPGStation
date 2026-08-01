'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/video/VideoAnalyzeJobModel').default;

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, debug: () => {} },
    }),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 完了するまで待つ (ジョブは start の後ろで非同期に進む)
 */
async function waitFinish(model, timeoutMs = 3000) {
    const limit = Date.now() + timeoutMs;
    for (;;) {
        const job = model.getJob();
        if (job.status !== 'running') return job;
        if (Date.now() > limit) throw new Error(`job did not finish: ${JSON.stringify(job)}`);
        await sleep(5);
    }
}

/**
 * ids: 解析対象の video file id 一覧
 * failIds: 解析に失敗させる id
 */
function fixture(ids, options = {}) {
    const failIds = new Set(options.failIds ?? []);
    // 「解析済みになった id」= 未解析クエリの対象から外れる
    const analyzed = new Set();
    const calls = [];

    const unanalyzed = () => ids.filter(id => analyzed.has(id) === false);
    const page = (list, limit, offset) => list.slice(offset, offset + limit);

    const videoFileDB = {
        countAll: async () => ids.length,
        countWithoutMetadata: async () => unanalyzed().length,
        findAllPaged: async (limit, offset) => page(ids, limit, offset).map(id => ({ id })),
        findWithoutMetadata: async (limit, offset = 0) => page(unanalyzed(), limit, offset).map(id => ({ id })),
    };
    const videoFileTsInfoDB = {
        countAnalyzed: async () => ids.length,
        findAnalyzedVideoFileIds: async (limit, offset) => page(ids, limit, offset),
        countAnalyzableVideoFiles: async () => ids.length,
        countWithoutTsInfo: async () => unanalyzed().length,
        findAllAnalyzable: async (limit, offset) => page(ids, limit, offset).map(id => ({ id })),
        findWithoutTsInfo: async (limit, offset = 0) => page(unanalyzed(), limit, offset).map(id => ({ id })),
    };
    const analyzeModel = {
        applyStoredChannelInfo: async id => {
            calls.push(['channel', id]);
            if (failIds.has(id) === true) throw new Error('boom');
            return true;
        },
        analyzeMetadata: async id => {
            calls.push(['metadata', id]);
            if (failIds.has(id) === true) throw new Error('boom');
            analyzed.add(id);
            if (options.slowMs) await sleep(options.slowMs);
            return {};
        },
        analyzeTsInfo: async id => {
            calls.push(['tsInfo', id]);
            if (failIds.has(id) === true) throw new Error('boom');
            analyzed.add(id);
            if (options.slowMs) await sleep(options.slowMs);
            return true;
        },
    };

    return { model: new Model(videoFileDB, videoFileTsInfoDB, analyzeModel, logger), calls };
}

test('a started job reports its target count and finishes with per-file results', async () => {
    const { model, calls } = fixture([1, 2, 3], { failIds: [2] });

    const started = await model.start({ type: 'metadata', mode: 'unanalyzed' });
    assert.equal(started.status, 'running');
    assert.equal(started.type, 'metadata');
    assert.equal(started.total, 3);

    const finished = await waitFinish(model);
    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.processed, 3);
    assert.equal(finished.analyzed, 2);
    assert.equal(finished.failed, 1);
    assert.notEqual(finished.finishedAt, null);
    assert.deepEqual(
        calls.map(c => c[0]),
        ['metadata', 'metadata', 'metadata'],
    );
});

test('files that keep failing do not make the unanalyzed job loop forever', async () => {
    // 全件失敗 = 解析済みにならないため、offset を進めないと同じ行を引き続けてしまう
    const { model, calls } = fixture([1, 2, 3, 4], { failIds: [1, 2, 3, 4] });

    await model.start({ type: 'tsInfo', mode: 'unanalyzed' });
    const finished = await waitFinish(model);

    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.failed, 4);
    assert.equal(calls.length, 4);
});

test('the all mode reanalyzes files that have already been analyzed', async () => {
    const { model, calls } = fixture([1, 2, 3]);

    // 1 度目で全件解析済みになる
    await model.start({ type: 'metadata', mode: 'unanalyzed' });
    await waitFinish(model);
    assert.equal(calls.length, 3);

    // unanalyzed では対象が無くなるが、all なら解析済みでも引き直す
    await model.start({ type: 'metadata', mode: 'unanalyzed' });
    const skipped = await waitFinish(model);
    assert.equal(skipped.total, 0);
    assert.equal(calls.length, 3);

    await model.start({ type: 'metadata', mode: 'all' });
    const forced = await waitFinish(model);
    assert.equal(forced.total, 3);
    assert.equal(forced.analyzed, 3);
    assert.equal(calls.length, 6);
});

test('a second job is refused while one is running, and cancel stops the running one', async () => {
    const { model } = fixture([1, 2, 3, 4, 5], { slowMs: 30 });

    await model.start({ type: 'tsInfo', mode: 'all' });
    await assert.rejects(() => model.start({ type: 'metadata' }), /VideoAnalyzeJobIsAlreadyRunning/);

    model.cancel();
    const finished = await waitFinish(model);
    assert.equal(finished.status, 'canceled');
    assert.ok(finished.processed < 5);

    // 中断後は次のジョブを開始できる
    const restarted = await model.start({ type: 'tsInfo', mode: 'all' });
    assert.equal(restarted.status, 'running');
    model.cancel();
    await waitFinish(model);
});

test('invalid type or mode is rejected before the job starts', async () => {
    const { model } = fixture([1]);

    await assert.rejects(() => model.start({ type: 'unknown' }), /InvalidVideoAnalyzeJobType/);
    await assert.rejects(() => model.start({ type: 'metadata', mode: 'everything' }), /InvalidVideoAnalyzeJobMode/);
    assert.equal(model.getJob().status, 'idle');
});

test('a database failure marks the job as failed instead of leaving it running', async () => {
    const { model } = fixture([1, 2]);
    model.videoFileDB.findWithoutMetadata = async () => {
        throw new Error('db is down');
    };

    await model.start({ type: 'metadata' });
    const finished = await waitFinish(model);

    assert.equal(finished.status, 'failed');
    assert.equal(finished.error, 'db is down');
});

test('the channel type reapplies stored ts info without touching the files', async () => {
    const { model, calls } = fixture([1, 2, 3]);

    const started = await model.start({ type: 'channel' });
    assert.equal(started.total, 3);

    const finished = await waitFinish(model);
    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.analyzed, 3);
    assert.deepEqual(
        calls.map(c => c[0]),
        ['channel', 'channel', 'channel'],
    );
});
