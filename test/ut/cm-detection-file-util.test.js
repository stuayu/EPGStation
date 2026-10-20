'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const CmDetectionFileUtil = require('../../dist/util/CmDetectionFileUtil').default;
const ChapterFileUtil = require('../../dist/util/ChapterFileUtil').default;
const RecordedManageModel = require('../../dist/model/operator/recorded/RecordedManageModel').default;

test('CM副ファイルは判定JSONがあるときだけEPGStation所有として列挙する', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-cm-sidecars-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const videoPath = path.join(directory, 'video.hevc.ts');
    const evidencePath = CmDetectionFileUtil.getEvidencePath(videoPath);
    const chapterPath = ChapterFileUtil.getChapterFilePath(videoPath);
    fs.writeFileSync(chapterPath, 'Amatsukaze chapter');
    assert.deepEqual(CmDetectionFileUtil.getOwnedSidecarPaths(videoPath), []);
    fs.writeFileSync(evidencePath, '{}');
    assert.deepEqual(CmDetectionFileUtil.getOwnedSidecarPaths(videoPath), [evidencePath, chapterPath]);
});

test('録画ファイル削除はEPGStation所有の副ファイルだけを消す', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-cm-delete-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const videoPath = path.join(directory, 'owned.ts');
    const chapterPath = ChapterFileUtil.getChapterFilePath(videoPath);
    const evidencePath = CmDetectionFileUtil.getEvidencePath(videoPath);
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(chapterPath, 'EPGStation chapter');
    fs.writeFileSync(evidencePath, '{}');

    const model = Object.create(RecordedManageModel.prototype);
    model.log = { system: { info() {}, warn() {}, error() {} } };
    model.videoFileDB = {
        findId: async () => ({ id: 1, recordedId: 9, isExternalFile: false }),
        deleteOnce: async () => {},
    };
    model.recordedDB = { findId: async () => ({ videoFiles: [{ id: 1 }] }) };
    model.videoUtil = { getFullFilePathFromId: async () => videoPath };
    model.watchHistoryDB = { deleteByVideoFileId: async () => {} };
    model.recordedEvent = { emitDeleteVideoFile() {} };
    await model.deleteVideoFile(1);
    assert.equal(fs.existsSync(videoPath), false);
    assert.equal(fs.existsSync(chapterPath), false);
    assert.equal(fs.existsSync(evidencePath), false);

    const externalPath = path.join(directory, 'external.ts');
    const externalChapterPath = ChapterFileUtil.getChapterFilePath(externalPath);
    fs.writeFileSync(externalPath, 'external video');
    fs.writeFileSync(externalChapterPath, 'Amatsukaze chapter');
    model.videoFileDB = {
        findId: async () => ({ id: 2, recordedId: 10, isExternalFile: true }),
        deleteOnce: async () => {},
    };
    model.recordedDB = { findId: async () => ({ videoFiles: [{ id: 2 }] }) };
    model.videoUtil = { getFullFilePathFromId: async () => externalPath };
    await model.deleteVideoFile(2);
    assert.equal(fs.existsSync(externalPath), true);
    assert.equal(fs.existsSync(externalChapterPath), true);
});
