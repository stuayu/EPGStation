'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const RecordedApiModel = require('../../dist/model/api/recorded/RecordedApiModel').default;

const tempFile = (name = 'sample.ts') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'x');
    return file;
};

const itemUtil = { convertRecordedToRecordedItem: value => value };
const config = enabled => ({
    getConfig: () => ({ featureFlags: { watchHistory: true, externalFileImport: enabled } }),
});

test('external import validates files and delegates batch import', async () => {
    const file = tempFile('Anime01.ts');
    let imported;
    const model = new RecordedApiModel(
        {},
        { findAll: async () => [[], 0], findId: async () => null, findIds: async () => [] },
        { getRecordedIndex: () => ({}) },
        itemUtil,
        config(true),
        { findByVideoFileIds: async () => [] },
        { findLink: async () => null, listRecorded: async () => [] },
        { getInfo: async () => ({ duration: 120, size: 1, bitRate: 1 }) },
        {
            importExternalRecordedFiles: async items => {
                imported = items;
                return items.map((x, i) => ({
                    localFilePath: x.localFilePath,
                    imported: true,
                    recordedId: i + 1,
                    name: 'ok',
                }));
            },
        },
    );

    const result = await model.importExternalRecordedFiles({
        channelId: 1,
        parentDirectoryName: 'default',
        fileType: 'ts',
        localFilePaths: [file],
    });

    assert.equal(result.items[0].recordedId, 1);
    assert.equal(imported[0].localFilePath, file);
});

test('external import respects feature flag', async () => {
    const model = new RecordedApiModel(
        {},
        { findAll: async () => [[], 0], findId: async () => null, findIds: async () => [] },
        { getRecordedIndex: () => ({}) },
        itemUtil,
        config(false),
        { findByVideoFileIds: async () => [] },
        { findLink: async () => null, listRecorded: async () => [] },
        { getInfo: async () => ({ duration: 1, size: 1, bitRate: 1 }) },
        { importExternalRecordedFiles: async () => [] },
    );

    await assert.rejects(
        () =>
            model.importExternalRecordedFiles({
                channelId: 1,
                parentDirectoryName: 'x',
                fileType: 'ts',
                localFilePaths: ['/tmp/a.ts'],
            }),
        /ExternalFileImportFeatureIsDisabled/,
    );
});
