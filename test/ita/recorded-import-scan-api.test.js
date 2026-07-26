'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const RecordedApiModel = require('../../dist/model/api/recorded/RecordedApiModel').default;

const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-scan-'));

const itemUtil = { convertRecordedToRecordedItem: value => value };
const baseChannel = { id: 1, name: 'TOKYOMX', halfWidthName: 'TOKYOMX' };

function buildModel({ enabled, importDirs, recordedDB, channelDB }) {
    return new RecordedApiModel(
        {},
        recordedDB ?? { findAll: async () => [[], 0], findId: async () => null, findIds: async () => [], findDuplicateCandidates: async () => [] },
        { getRecordedIndex: () => ({}) },
        itemUtil,
        { getConfig: () => ({ featureFlags: { externalFileImport: enabled }, importDirs, importFileNamePatterns: [] }) },
        { findByVideoFileIds: async () => [] },
        { findLink: async () => null, listRecorded: async () => [] },
        channelDB ?? { findAll: async () => [baseChannel] },
    );
}

test('scan is rejected while the feature flag is off', async () => {
    const model = buildModel({ enabled: false, importDirs: [] });
    await assert.rejects(() => model.scanImportDirectory({ importDirName: 'edcb' }), /ExternalFileImportFeatureIsDisabled/);
});

test('scan rejects an unknown importDirName', async () => {
    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: mkTmpDir() }] });
    await assert.rejects(() => model.scanImportDirectory({ importDirName: 'unknown' }), /ImportDirNotFound/);
});

test('scan finds candidate files and estimates channel/name from the file name', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, '202607262100_サンプル番組_TOKYOMX.ts'), 'x');

    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: dir }] });
    const result = await model.scanImportDirectory({ importDirName: 'edcb' });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].estimatedName, 'サンプル番組');
    assert.equal(result.items[0].estimatedChannelName, 'TOKYOMX');
    assert.equal(result.items[0].estimatedChannelId, 1);
    assert.equal(result.items[0].hasProgramTxt, false);
});

test('scan flags a candidate as a possible duplicate when a matching recorded exists', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, '202607262100_サンプル番組_TOKYOMX.ts'), 'x');

    const recordedDB = {
        findDuplicateCandidates: async () => [{ id: 42 }],
    };
    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: dir }], recordedDB });
    const result = await model.scanImportDirectory({ importDirName: 'edcb' });

    assert.deepEqual(result.items[0].duplicateRecordedIds, [42]);
});

test('scan rejects a subPath that escapes the import directory', async () => {
    const dir = mkTmpDir();
    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: dir }] });
    await assert.rejects(() => model.scanImportDirectory({ importDirName: 'edcb', subPath: '../../etc' }), /InvalidSubDirectory/);
});
