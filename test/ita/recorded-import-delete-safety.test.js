'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const RecordedManageModel = require('../../dist/model/operator/recorded/RecordedManageModel').default;

const mkTmpFile = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-delete-'));
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');

    return file;
};

const noopLogger = { system: { info: () => {}, warn: () => {}, error: () => {} } };
const logger = { getLogger: () => noopLogger };

function buildModel({ recorded, videoUtil }) {
    return new RecordedManageModel(
        logger,
        { getConfig: () => ({ recorded: [], thumbnail: '/thumb', dropLog: '/drop' }) },
        { findId: async () => recorded, deleteOnce: async () => {} },
        { findId: async () => null },
        { deleteRecordedId: async () => {}, findId: async () => null, deleteOnce: async () => {} },
        { deleteRecordedId: async () => {} },
        { findAll: async () => [], deleteOnce: async () => {} },
        { delete: async () => {} },
        { deleteByRecordedId: async () => {}, deleteByVideoFileId: async () => {} },
        { hasReserve: () => false, cancel: async () => {} },
        { emitDeleteRecorded: () => {}, emitDeleteVideoFile: () => {} },
        videoUtil,
        { formatFilePathString: async s => s },
    );
}

test('delete() (recorded 削除) skips unlinking video files flagged isExternalFile', async () => {
    const file = mkTmpFile();
    const recorded = {
        id: 1,
        isProtected: false,
        isRecording: false,
        reserveId: null,
        thumbnails: [],
        videoFiles: [{ id: 100, isExternalFile: true }],
        dropLogFile: null,
    };
    const videoUtil = { getFullFilePathFromId: async () => file };

    const model = buildModel({ recorded, videoUtil });
    await model.delete(1, true);

    assert.equal(fs.existsSync(file), true, 'register モードで取り込んだ実ファイルは削除されてはいけない');
});

test('delete() still removes real video files that are not external', async () => {
    const file = mkTmpFile();
    const recorded = {
        id: 2,
        isProtected: false,
        isRecording: false,
        reserveId: null,
        thumbnails: [],
        videoFiles: [{ id: 101, isExternalFile: false }],
        dropLogFile: null,
    };
    const videoUtil = { getFullFilePathFromId: async () => file };

    const model = buildModel({ recorded, videoUtil });
    await model.delete(2, true);

    assert.equal(fs.existsSync(file), false, '通常の録画ファイルは従来通り削除されること');
});

test('deleteVideoFile() skips unlinking a video file flagged isExternalFile', async () => {
    const file = mkTmpFile();
    const video = { id: 200, recordedId: 1, isExternalFile: true };
    const model = buildModel({
        recorded: { id: 1, isProtected: false, isRecording: false, videoFiles: [] },
        videoUtil: { getFullFilePathFromId: async () => file },
    });
    model['videoFileDB'] = {
        findId: async () => video,
        deleteOnce: async () => {},
    };

    await model.deleteVideoFile(200, true);

    assert.equal(fs.existsSync(file), true, 'register モードで取り込んだ実ファイルは削除されてはいけない');
});
