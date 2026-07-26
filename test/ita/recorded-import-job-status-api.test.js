'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordedApiModel = require('../../dist/model/api/recorded/RecordedApiModel').default;

const itemUtil = { convertRecordedToRecordedItem: value => value };

function buildModel({ enabled, ipc }) {
    return new RecordedApiModel(
        ipc,
        { findAll: async () => [[], 0], findId: async () => null, findIds: async () => [], findDuplicateCandidates: async () => [] },
        { getRecordedIndex: () => ({}) },
        itemUtil,
        { getConfig: () => ({ featureFlags: { externalFileImport: enabled } }) },
        { findByVideoFileIds: async () => [] },
        { findLink: async () => null, listRecorded: async () => [] },
        { findAll: async () => [] },
    );
}

test('startImportJob / getImportJobStatus / retryImportJob reject while the feature flag is off', async () => {
    const model = buildModel({ enabled: false, ipc: {} });
    await assert.rejects(() => model.startImportJob({ items: [] }), /ExternalFileImportFeatureIsDisabled/);
    await assert.rejects(() => model.getImportJobStatus('job1'), /ExternalFileImportFeatureIsDisabled/);
    await assert.rejects(() => model.retryImportJob('job1'), /ExternalFileImportFeatureIsDisabled/);
});

test('startImportJob delegates to IPC and returns the issued jobId', async () => {
    let sentItems;
    const ipc = {
        recorded: {
            startImportJob: async items => {
                sentItems = items;
                return 'job-123';
            },
        },
    };
    const model = buildModel({ enabled: true, ipc });

    const result = await model.startImportJob({
        items: [
            {
                filePath: '/edcb/sample.ts',
                channelId: 1,
                name: 'サンプル',
                startAt: 1000,
                parentDirectoryName: 'recorded',
                fileType: 'ts',
            },
        ],
    });

    assert.equal(result.jobId, 'job-123');
    assert.equal(sentItems[0].localFilePath, '/edcb/sample.ts');
});

test('startImportJob rejects an empty item list without calling IPC', async () => {
    let called = false;
    const ipc = { recorded: { startImportJob: async () => ((called = true), 'job') } };
    const model = buildModel({ enabled: true, ipc });

    await assert.rejects(() => model.startImportJob({ items: [] }), /ImportItemsAreEmpty/);
    assert.equal(called, false);
});

test('getImportJobStatus and retryImportJob proxy to IPC', async () => {
    const status = { jobId: 'job-1', total: 2, done: 2, successCount: 1, failedCount: 1, isRunning: false, results: [] };
    const ipc = {
        recorded: {
            getImportJobStatus: async jobId => (jobId === 'job-1' ? status : null),
            retryImportJob: async jobId => (jobId === 'job-1' ? 'job-2' : null),
        },
    };
    const model = buildModel({ enabled: true, ipc });

    assert.deepEqual(await model.getImportJobStatus('job-1'), status);
    assert.equal(await model.getImportJobStatus('unknown'), null);
    assert.deepEqual(await model.retryImportJob('job-1'), { jobId: 'job-2' });
    assert.equal(await model.retryImportJob('unknown'), null);
});
