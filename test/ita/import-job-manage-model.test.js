'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ImportJobManageModel = require('../../dist/model/operator/recorded/ImportJobManageModel').default;

const noopLogger = { system: { info: () => {}, warn: () => {}, error: () => {} } };
const logger = { getLogger: () => noopLogger };

const waitUntil = async predicate => {
    for (let i = 0; i < 200; i++) {
        if (predicate() === true) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timeout waiting for condition');
};

test('start() returns immediately and processes items sequentially in the background', async () => {
    let callCount = 0;
    const recordedManage = {
        importExternalRecordedFiles: async items => {
            callCount++;
            return [{ localFilePath: items[0].localFilePath, imported: true, recordedId: callCount }];
        },
    };
    const manage = new ImportJobManageModel(logger, recordedManage);

    const jobId = manage.start([{ localFilePath: '/a.ts' }, { localFilePath: '/b.ts' }]);
    assert.equal(typeof jobId, 'string');

    // start() 自体は同期的に返る (バックグラウンドで処理される)
    const initial = manage.getStatus(jobId);
    assert.equal(initial.total, 2);

    await waitUntil(() => manage.getStatus(jobId).isRunning === false);

    const finalStatus = manage.getStatus(jobId);
    assert.equal(finalStatus.done, 2);
    assert.equal(finalStatus.successCount, 2);
    assert.equal(finalStatus.failedCount, 0);
});

test('getStatus returns null for an unknown jobId', () => {
    const manage = new ImportJobManageModel(logger, { importExternalRecordedFiles: async () => [] });
    assert.equal(manage.getStatus('unknown'), null);
});

test('retryFailed only re-runs failed items and returns null when there is nothing to retry', async () => {
    // '/fail.ts' は 1 回目のみ失敗させ、再実行 (retry) では成功する transient failure を模す
    const failedOnce = new Set();
    const recordedManage = {
        importExternalRecordedFiles: async items => {
            const p = items[0].localFilePath;
            if (p === '/fail.ts' && failedOnce.has(p) === false) {
                failedOnce.add(p);

                return [{ localFilePath: p, imported: false, error: 'boom' }];
            }

            return [{ localFilePath: p, imported: true, recordedId: 1 }];
        },
    };
    const manage = new ImportJobManageModel(logger, recordedManage);

    const jobId = manage.start([{ localFilePath: '/ok.ts' }, { localFilePath: '/fail.ts' }]);
    await waitUntil(() => manage.getStatus(jobId).isRunning === false);
    assert.equal(manage.getStatus(jobId).failedCount, 1);

    const retryJobId = manage.retryFailed(jobId);
    assert.notEqual(retryJobId, null);
    await waitUntil(() => manage.getStatus(retryJobId).isRunning === false);
    assert.equal(manage.getStatus(retryJobId).total, 1);
    assert.equal(manage.getStatus(retryJobId).failedCount, 0);

    // 失敗が無いジョブを retry しても null が返る
    assert.equal(manage.retryFailed(retryJobId), null);
});
