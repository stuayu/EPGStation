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

function buildModel({ recorded, videoUtil, recordedDB, recordedEvent, config }) {
    return new RecordedManageModel(
        logger,
        { getConfig: () => config ?? { recorded: [], thumbnail: '/thumb', dropLog: '/drop' } },
        recordedDB ?? { findId: async () => recorded, deleteOnce: async () => {}, deleteRecordedWithRelatedData: async () => {} },
        { findId: async () => null },
        { deleteRecordedId: async () => {}, findId: async () => null, deleteOnce: async () => {} },
        { deleteRecordedId: async () => {} },
        { findAll: async () => [], deleteOnce: async () => {} },
        { delete: async () => {} },
        { deleteByRecordedId: async () => {}, deleteByVideoFileId: async () => {} },
        { hasReserve: () => false, cancel: async () => {} },
        recordedEvent ?? { emitDeleteRecorded: () => {}, emitDeleteVideoFile: () => {} },
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

test('delete() restores staged files and does not emit an event when DB deletion fails', async () => {
    const file = mkTmpFile();
    let emitted = false;
    const recorded = {
        id: 3,
        isProtected: false,
        isRecording: false,
        reserveId: null,
        thumbnails: [],
        videoFiles: [{ id: 102, isExternalFile: false }],
        dropLogFile: null,
    };
    const model = buildModel({
        recorded,
        videoUtil: { getFullFilePathFromId: async () => file },
        recordedDB: {
            findId: async () => recorded,
            deleteRecordedWithRelatedData: async () => {
                throw new Error('database is locked');
            },
        },
        recordedEvent: { emitDeleteRecorded: () => { emitted = true; } },
    });

    await assert.rejects(model.delete(3, true), /database is locked/);
    assert.equal(fs.existsSync(file), true, 'DB失敗時は退避した録画ファイルを元へ戻すこと');
    assert.equal(emitted, false, 'DB失敗時は削除イベントを発行しないこと');
});

test('delete() emits the delete event even when staged file cleanup fails', async () => {
    const file = mkTmpFile();
    let emitted = false;
    const recorded = {
        id: 4,
        isProtected: false,
        isRecording: false,
        reserveId: null,
        thumbnails: [],
        videoFiles: [{ id: 103, isExternalFile: false }],
        dropLogFile: null,
    };
    const model = buildModel({
        recorded,
        videoUtil: { getFullFilePathFromId: async () => file },
        recordedDB: {
            findId: async () => recorded,
            deleteRecordedWithRelatedData: async () => {},
        },
        recordedEvent: { emitDeleteRecorded: () => { emitted = true; } },
    });
    // 退避後の unlink だけを失敗させる
    const FileUtil = require('../../dist/util/FileUtil').default;
    const originalUnlink = FileUtil.unlink;
    FileUtil.unlink = async () => {
        throw new Error('EPERM');
    };

    try {
        await assert.rejects(model.delete(4, true), /RecordedDeleteCleanupRequired/);
    } finally {
        FileUtil.unlink = originalUnlink;
    }
    assert.equal(emitted, true, 'DB削除が済んでいれば後始末に失敗しても削除イベントを発行すること');
});

test('delete() still removes DB rows when a video file path cannot be resolved', async () => {
    let emitted = false;
    let dbDeleted = false;
    const recorded = {
        id: 5,
        isProtected: false,
        isRecording: false,
        reserveId: null,
        thumbnails: [],
        videoFiles: [{ id: 104, isExternalFile: false }],
        dropLogFile: null,
    };
    const model = buildModel({
        recorded,
        videoUtil: { getFullFilePathFromId: async () => null },
        recordedDB: {
            findId: async () => recorded,
            deleteRecordedWithRelatedData: async () => {
                dbDeleted = true;
            },
        },
        recordedEvent: { emitDeleteRecorded: () => { emitted = true; } },
    });

    await model.delete(5, true);
    assert.equal(dbDeleted, true, 'パス解決に失敗しても DB 側の削除は続行すること');
    assert.equal(emitted, true, '削除イベントを発行すること');
});

test('videoFileCleanup() removes staged files left behind by an interrupted delete', async () => {
    const thumbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-staged-'));
    const staged = path.join(thumbDir, '.1-poster.jpg.deleting-1-0');
    const kept = path.join(thumbDir, '1-poster.jpg');
    fs.writeFileSync(staged, 'x');
    fs.writeFileSync(kept, 'x');

    const model = buildModel({
        recorded: null,
        videoUtil: {},
        config: { recorded: [], thumbnail: thumbDir, dropLog: thumbDir },
    });
    // 動画ファイルの走査は行わず、退避ファイルの掃除だけを見る
    model.scanOrphanVideoFiles = async () => ({ orphanFiles: [], orphanDirectories: [], missingDBVideoFiles: [] });

    await model.videoFileCleanup();

    assert.equal(fs.existsSync(staged), false, '中断された削除の退避ファイルを掃除すること');
    assert.equal(fs.existsSync(kept), true, '通常のファイルは残すこと');
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
