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

function buildModel({
    config,
    videoFileDB,
    recordedDB,
    recordedEvent,
    videoUtil,
    tsInfoAnalyzer,
    videoFileAnalyzeModel,
    channelDB,
}) {
    const recordingUtilModel = { formatFilePathString: async (str, _recorded) => str };
    return new RecordedManageModel(
        logger,
        { getConfig: () => config },
        recordedDB,
        channelDB ?? { findId: async () => null, findNetworkIdAndServiceId: async () => null },
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
        // TS 解析。既定では何も取れなかった扱いにして、従来どおりファイル名・mtime からの推定を通す
        tsInfoAnalyzer ?? { analyze: async () => emptyTsInfo() },
        videoFileAnalyzeModel ?? {
            analyzeAll: async () => {},
            analyzeMetadata: async () => ({}),
            analyzeTsInfo: async () => false,
            saveTsInfo: async () => {},
            toMetadataResult: v => v,
        },
    );
}

/**
 * 何も取得できなかったときの TS 解析結果
 */
function emptyTsInfo() {
    return {
        networkId: null,
        transportStreamId: null,
        serviceId: null,
        serviceType: null,
        serviceName: null,
        serviceProviderName: null,
        networkName: null,
        eventId: null,
        eventName: null,
        eventDescription: null,
        eventExtended: null,
        eventStartAt: null,
        eventDuration: null,
        genres: [],
        videoStreamType: null,
        videoPid: null,
        audioStreamType: null,
        audioPid: null,
        firstTdtAt: null,
    };
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


test('TS 解析で放送局と番組情報が取れた場合はそれを使って登録する', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');

    let createdRecorded;
    const recordedDB = {
        insertOnce: async recorded => {
            createdRecorded = recorded;
            return 1;
        },
        findId: async () => ({ id: 1, thumbnails: [] }),
    };
    const videoFileDB = { insertOnce: async () => 100 };

    const tsInfo = Object.assign(emptyTsInfo(), {
        networkId: 32416,
        serviceId: 21504,
        serviceName: 'ＮＨＫ総合１・福島',
        eventId: 31702,
        eventName: 'ＴＳ から取れた番組名',
        eventDescription: '概要',
        eventExtended: '詳細',
        eventStartAt: 1800000000000,
        eventDuration: 1800,
        genres: [{ lv1: 7, lv2: 0 }],
        firstTdtAt: 1799999997000,
    });

    const savedTsInfo = [];
    const model = buildModel({
        config: {
            recorded: [{ name: 'recorded', path: path.join(dir, 'out') }],
            importDirs: [{ name: 'import', path: dir }],
        },
        recordedDB,
        videoFileDB,
        // 放送局は network id + service id で引けたものを優先する
        channelDB: {
            findId: async () => null,
            findNetworkIdAndServiceId: async (networkId, serviceId) =>
                networkId === 32416 && serviceId === 21504 ? { id: 3241621504 } : null,
        },
        tsInfoAnalyzer: { analyze: async () => tsInfo },
        videoFileAnalyzeModel: {
            analyzeAll: async () => {},
            analyzeMetadata: async () => ({}),
            analyzeTsInfo: async () => false,
            saveTsInfo: async (videoFileId, info) => savedTsInfo.push({ videoFileId, info }),
            toMetadataResult: v => v,
        },
    });

    const [result] = await model.importExternalRecordedFiles([
        {
            localFilePath: file,
            parentDirectoryName: 'recorded',
            fileType: 'ts',
            // 画面から渡された放送局は TS から特定できた放送局で上書きされる
            channelId: 1,
        },
    ]);

    assert.equal(result.imported, true);
    assert.equal(createdRecorded.channelId, 3241621504);
    assert.equal(createdRecorded.name, 'ＴＳ から取れた番組名');
    assert.equal(createdRecorded.description, '概要');
    assert.equal(createdRecorded.extended, '詳細');
    assert.equal(createdRecorded.genre1, 7);
    assert.equal(createdRecorded.startAt, 1800000000000);
    assert.equal(createdRecorded.endAt, 1800000000000 + 1800 * 1000);

    // 解析結果はビデオファイルに紐づけて保存される
    assert.equal(savedTsInfo.length, 1);
    assert.equal(savedTsInfo[0].videoFileId, 100);
    assert.equal(savedTsInfo[0].info.eventId, 31702);
});

test('画面から番組名・時刻を指定した場合は TS 解析より優先する', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');

    let createdRecorded;
    const recordedDB = {
        insertOnce: async recorded => {
            createdRecorded = recorded;
            return 1;
        },
        findId: async () => ({ id: 1, thumbnails: [] }),
    };

    const tsInfo = Object.assign(emptyTsInfo(), {
        eventName: 'ＴＳ の番組名',
        eventStartAt: 1800000000000,
        eventDuration: 1800,
    });

    const model = buildModel({
        config: {
            recorded: [{ name: 'recorded', path: path.join(dir, 'out') }],
            importDirs: [{ name: 'import', path: dir }],
        },
        recordedDB,
        videoFileDB: { insertOnce: async () => 100 },
        tsInfoAnalyzer: { analyze: async () => tsInfo },
    });

    const [result] = await model.importExternalRecordedFiles([
        {
            localFilePath: file,
            parentDirectoryName: 'recorded',
            fileType: 'ts',
            channelId: 1,
            name: '画面で入力した番組名',
            startAt: 1700000000000,
            endAt: 1700000600000,
        },
    ]);

    assert.equal(result.imported, true);
    assert.equal(createdRecorded.name, '画面で入力した番組名');
    assert.equal(createdRecorded.startAt, 1700000000000);
    assert.equal(createdRecorded.endAt, 1700000600000);
});
