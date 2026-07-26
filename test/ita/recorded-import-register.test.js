'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const RecordedManageModel = require('../../dist/model/operator/recorded/RecordedManageModel').default;

const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-register-'));
const noopLogger = { system: { info: () => {}, warn: () => {}, error: () => {} } };
const logger = { getLogger: () => noopLogger };

function buildModel({ config, videoFileDB, recordedDB, recordedEvent, videoUtil }) {
    const recordingUtilModel = { formatFilePathString: async (str, _recorded) => str };
    return new RecordedManageModel(
        logger,
        { getConfig: () => config },
        recordedDB,
        { findId: async () => null },
        videoFileDB,
        { deleteRecordedId: async () => {} },
        { findAll: async () => [], deleteOnce: async () => {} },
        { delete: async () => {} },
        { deleteByRecordedId: async () => {}, deleteByVideoFileId: async () => {} },
        { hasReserve: () => false, cancel: async () => {} },
        recordedEvent ?? {
            emitCreateNewRecorded: () => {},
            emitAddUploadedVideoFile: () => {},
            emitAddVideoFile: () => {},
            emitDeleteRecorded: () => {},
        },
        videoUtil ?? {
            getInfo: async () => ({ duration: 120, size: 1, bitRate: 1 }),
            getFullFilePathFromId: async () => null,
            getParentDirPath: name => {
                if (name === config.recorded[0]?.name) return config.recorded[0].path;
                const importDir = (config.importDirs ?? []).find(d => d.name === name);
                return importDir ? importDir.path : null;
            },
        },
        recordingUtilModel,
    );
}

test('register mode adds a video file pointing at the importDirs entry and never touches the original file', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');

    let insertedVideoFile;
    const recordedDB = {
        insertOnce: async () => 1,
        findId: async () => ({ id: 1, thumbnails: [] }),
    };
    const videoFileDB = {
        insertOnce: async video => {
            insertedVideoFile = video;
            return 100;
        },
    };
    const config = {
        importDirs: [{ name: 'edcb', path: dir }],
        importDefaultMode: 'register',
        recorded: [{ name: 'recorded', path: path.join(dir, 'recorded') }],
    };

    const model = buildModel({ config, videoFileDB, recordedDB });
    const results = await model.importExternalRecordedFiles([
        { localFilePath: file, parentDirectoryName: 'recorded', fileType: 'ts', channelId: 1 },
    ]);

    assert.equal(results[0].imported, true);
    assert.equal(insertedVideoFile.isExternalFile, true);
    assert.equal(insertedVideoFile.parentDirectoryName, 'edcb');
    assert.equal(insertedVideoFile.filePath, 'sample.ts');

    // 元ファイルは一切操作されず存在し続けること
    assert.equal(fs.existsSync(file), true);
});

test('a path outside importDirs is rejected and never touched', async () => {
    const importDir = mkTmpDir();
    const outsideDir = mkTmpDir();
    const file = path.join(outsideDir, 'secret.ts');
    fs.writeFileSync(file, 'x');

    const config = { importDirs: [{ name: 'edcb', path: importDir }], recorded: [{ name: 'recorded', path: importDir }] };
    const model = buildModel({
        config,
        videoFileDB: { insertOnce: async () => 1 },
        recordedDB: { insertOnce: async () => 1, findId: async () => ({ id: 1, thumbnails: [] }) },
    });

    const results = await model.importExternalRecordedFiles([
        { localFilePath: file, parentDirectoryName: 'recorded', fileType: 'ts', channelId: 1 },
    ]);

    assert.equal(results[0].imported, false);
    assert.match(results[0].error, /ImportPathNotAllowed/);
    assert.equal(fs.existsSync(file), true);
});

test('duplicateAction "skip" avoids creating a recorded entry and does not run ffprobe', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');

    let createNewRecordedCalled = false;
    let ffprobeCalled = false;
    const recordedDB = {
        insertOnce: async () => {
            createNewRecordedCalled = true;
            return 1;
        },
        findId: async () => ({ id: 1, thumbnails: [] }),
    };
    const config = { importDirs: [{ name: 'edcb', path: dir }], recorded: [{ name: 'recorded', path: dir }] };
    const videoUtil = {
        getInfo: async () => {
            ffprobeCalled = true;
            return { duration: 1, size: 1, bitRate: 1 };
        },
        getFullFilePathFromId: async () => null,
    };

    const model = buildModel({ config, videoFileDB: { insertOnce: async () => 1 }, recordedDB, videoUtil });
    const results = await model.importExternalRecordedFiles([
        { localFilePath: file, parentDirectoryName: 'recorded', fileType: 'ts', channelId: 1, duplicateAction: 'skip' },
    ]);

    assert.equal(results[0].imported, false);
    assert.equal(results[0].skipped, true);
    assert.equal(createNewRecordedCalled, false);
    assert.equal(ffprobeCalled, false);
});

test('move mode relocates the file into the recorded directory via addUploadedVideoFile', async () => {
    const importDir = mkTmpDir();
    const recordedDir = mkTmpDir();
    const file = path.join(importDir, 'sample.ts');
    fs.writeFileSync(file, 'x');

    let insertedVideoFile;
    const recordedDB = {
        insertOnce: async () => 1,
        findId: async () => ({ id: 1, thumbnails: [] }),
    };
    const videoFileDB = {
        insertOnce: async video => {
            insertedVideoFile = video;
            return 100;
        },
    };
    const config = {
        importDirs: [{ name: 'edcb', path: importDir }],
        recorded: [{ name: 'recorded', path: recordedDir }],
    };

    const model = buildModel({ config, videoFileDB, recordedDB });
    const results = await model.importExternalRecordedFiles([
        { localFilePath: file, parentDirectoryName: 'recorded', fileType: 'ts', channelId: 1, mode: 'move' },
    ]);

    assert.equal(results[0].imported, true);
    assert.equal(insertedVideoFile.isExternalFile, false);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(path.join(recordedDir, 'sample.ts')), true);
});
