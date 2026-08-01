'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const RecordedManageModel = require('../../dist/model/operator/recorded/RecordedManageModel').default;

const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epgs-upload-auto-'));
const noopLogger = { system: { info: () => {}, warn: () => {}, error: () => {} } };
const logger = { getLogger: () => noopLogger };

/**
 * 放送 TS から取れた想定の解析結果
 */
function tsInfo(override) {
    return Object.assign(
        {
            networkId: 32416,
            transportStreamId: 32416,
            serviceId: 21504,
            serviceType: 1,
            serviceName: 'ＮＨＫ総合１・福島',
            serviceProviderName: null,
            networkName: null,
            eventId: 1,
            eventName: '被災地からの声',
            eventDescription: '概要',
            eventExtended: '詳細',
            eventStartAt: 1785544200000,
            eventDuration: 900,
            genres: [{ lv1: 0, lv2: 9 }],
            videoStreamType: null,
            videoPid: null,
            audioStreamType: null,
            audioPid: null,
            firstTdtAt: 1785544260000,
        },
        override,
    );
}

function buildModel(options) {
    const opt = options ?? {};
    const dir = opt.dir;
    const state = { inserted: [], insertedVideoFiles: [], deleted: [] };

    const recordedDB = {
        insertOnce: async recorded => {
            state.inserted.push(recorded);

            return 500;
        },
        findId: async id => (id === 500 ? { id: 500, thumbnails: [] } : (opt.existingRecorded ?? null)),
        updateChannel: async () => {},
        removeRecording: async () => {},
    };
    const videoFileDB = {
        insertOnce: async video => {
            state.insertedVideoFiles.push(video);

            return 900;
        },
        findAll: async () => [],
        deleteOnce: async () => {},
    };

    const model = new RecordedManageModel(
        logger,
        { getConfig: () => ({ recorded: [{ name: 'recorded', path: dir }] }) },
        recordedDB,
        opt.channelDB ?? {
            findId: async id =>
                id === 3241621504
                    ? { id: 3241621504, name: 'ＮＨＫ総合１・福島', halfWidthName: 'NHK総合1・福島' }
                    : null,
            findNetworkIdAndServiceId: async (networkId, serviceId) =>
                networkId === 32416 && serviceId === 21504
                    ? { id: 3241621504, name: 'ＮＨＫ総合１・福島', halfWidthName: 'NHK総合1・福島' }
                    : null,
        },
        videoFileDB,
        { deleteRecordedId: async () => {} },
        { findAll: async () => [], deleteOnce: async () => {} },
        { delete: async () => {} },
        { deleteByRecordedId: async () => {}, deleteByVideoFileId: async () => {} },
        { hasReserve: () => false, cancel: async () => {} },
        {
            emitCreateNewRecorded: () => {},
            emitAddUploadedVideoFile: () => {},
            emitAddVideoFile: () => {},
            emitDeleteRecorded: () => {},
        },
        {
            getInfo: async () => ({ duration: 120, size: 1, bitRate: 1 }),
            getFullFilePathFromId: async () => null,
            getParentDirPath: name => (name === 'recorded' ? dir : null),
        },
        { formatFilePathString: async str => str },
        { analyze: async () => opt.tsInfo ?? tsInfo() },
        {
            analyzeAll: async () => {},
            analyzeMetadata: async () => ({}),
            analyzeTsInfo: async () => false,
            saveTsInfo: async () => {},
            applyStoredChannelInfo: async () => false,
            toMetadataResult: v => v,
        },
    );

    return { model, state };
}

test('a TS upload without recordedId builds the program info from the broadcast stream', async () => {
    const dir = mkTmpDir();
    const uploaded = path.join(dir, 'uploaded.ts');
    fs.writeFileSync(uploaded, 'x');

    const { model, state } = buildModel({ dir });

    const recordedId = await model.addUploadedVideoFile({
        parentDirectoryName: 'recorded',
        viewName: 'sample.ts',
        fileType: 'ts',
        fileName: 'sample.ts',
        filePath: uploaded,
    });

    assert.equal(recordedId, 500);
    const recorded = state.inserted[0];
    assert.equal(recorded.name, '被災地からの声');
    assert.equal(recorded.channelId, 3241621504);
    assert.equal(recorded.channelName, 'ＮＨＫ総合１・福島');
    assert.equal(recorded.startAt, 1785544200000);
    // EIT の番組長 (900 秒) から終了時刻を決める
    assert.equal(recorded.endAt, 1785544200000 + 900 * 1000);
    assert.equal(recorded.genre1, 0);
    assert.equal(recorded.subGenre1, 9);
    assert.equal(state.insertedVideoFiles[0].recordedId, 500);
});

test('a tsreplace output (fileType encoded, .ts extension) is accepted because it still has PSI/SI', async () => {
    const dir = mkTmpDir();
    const uploaded = path.join(dir, 'uploaded.ts');
    fs.writeFileSync(uploaded, 'x');

    const { model, state } = buildModel({ dir });

    // tsreplace は映像だけ差し替えるので出力の拡張子は .ts のまま。
    // シークできるよう fileType は encoded で登録されるが PSI/SI は残っている
    const recordedId = await model.addUploadedVideoFile({
        parentDirectoryName: 'recorded',
        viewName: 'sample.ts',
        fileType: 'encoded',
        fileName: 'sample.ts',
        filePath: uploaded,
    });

    assert.equal(recordedId, 500);
    assert.equal(state.inserted[0].name, '被災地からの声');
    assert.equal(state.insertedVideoFiles[0].type, 'encoded');
});

test('an encoded upload without recordedId is refused and the temporary file is removed', async () => {
    const dir = mkTmpDir();
    const uploaded = path.join(dir, 'uploaded.mp4');
    fs.writeFileSync(uploaded, 'x');

    const { model, state } = buildModel({ dir });

    await assert.rejects(
        () =>
            model.addUploadedVideoFile({
                parentDirectoryName: 'recorded',
                viewName: 'sample.mp4',
                fileType: 'encoded',
                fileName: 'sample.mp4',
                filePath: uploaded,
            }),
        /RecordedIdIsRequired/,
    );

    assert.equal(state.inserted.length, 0);
    assert.equal(fs.existsSync(uploaded), false);
});

test('a TS whose broadcaster cannot be resolved is refused instead of guessing', async () => {
    const dir = mkTmpDir();
    const uploaded = path.join(dir, 'uploaded.ts');
    fs.writeFileSync(uploaded, 'x');

    // channel テーブルに無い放送局 (取り違えると実況や番組表がずれるため登録しない)
    const { model, state } = buildModel({ dir, tsInfo: tsInfo({ networkId: 1, serviceId: 2 }) });

    await assert.rejects(
        () =>
            model.addUploadedVideoFile({
                parentDirectoryName: 'recorded',
                viewName: 'sample.ts',
                fileType: 'ts',
                fileName: 'sample.ts',
                filePath: uploaded,
            }),
        /ChannelIsNotFound/,
    );

    assert.equal(state.inserted.length, 0);
    assert.equal(fs.existsSync(uploaded), false);
});

test('the recording start time falls back to TDT when the EIT has no start time', async () => {
    const dir = mkTmpDir();
    const uploaded = path.join(dir, 'uploaded.ts');
    fs.writeFileSync(uploaded, 'x');

    const { model, state } = buildModel({
        dir,
        tsInfo: tsInfo({ eventStartAt: null, eventDuration: null, eventName: null }),
    });

    await model.addUploadedVideoFile({
        parentDirectoryName: 'recorded',
        viewName: 'sample.ts',
        fileType: 'ts',
        fileName: 'sample.ts',
        filePath: uploaded,
    });

    const recorded = state.inserted[0];
    assert.equal(recorded.startAt, 1785544260000);
    // 番組長が取れないので実測尺 (120 秒) で埋める
    assert.equal(recorded.endAt, 1785544260000 + 120 * 1000);
    // 番組名も取れない場合はファイル名を使う
    assert.equal(recorded.name, 'sample');
});
