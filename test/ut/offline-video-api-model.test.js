'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');
const OfflineVideoApiModel = require('../../dist/model/api/video/OfflineVideoApiModel').default;

const video = { id: 7, recordedId: 4, size: 123, duration: 12 };
const recorded = { id: 4, isRecording: false, duration: 12 };

const makeModel = (recordedValue = recorded) => {
    let nextStreamId = 1;
    const stopped = [];
    const model = new OfflineVideoApiModel(
        {
            startRecordedOfflineHLSStream: async () => ({ streamId: nextStreamId++, stream: Readable.from([Buffer.from('fmp4')]) }),
            stop: async (streamId) => stopped.push(streamId),
        },
        { findId: async () => video },
        { findId: async () => recordedValue },
        {
            getOriginalFilePath: async videoFileId => ({ path: `file-${videoFileId}` }),
            getOriginalMpeg2FilePath: async videoFileId => ({ path: `file-${videoFileId}` }),
        },
    );
    return { model, stopped };
};

test('録画中のファイルはオフライン保存を409相当の業務エラーで拒否する', async () => {
    const { model } = makeModel({ ...recorded, isRecording: true });
    await assert.rejects(() => model.startOfflineStream(7, 'profile'), { message: 'RecordingVideoCannotBeSavedOffline' });
    assert.equal(model.getAvailableSlotCount(), 3);
});

test('同時実行枠は3件で、終了時に枠を返す', async () => {
    const { model, stopped } = makeModel();
    const streams = await Promise.all([1, 2, 3].map(() => model.startOfflineStream(7, 'profile')));
    assert.equal(model.getAvailableSlotCount(), 0);
    let fourthResolved = false;
    let fourthResult;
    const fourth = model.startOfflineStream(7, 'profile').then(result => { fourthResult = result; fourthResolved = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fourthResolved, false);
    await streams[0].cleanup();
    await fourth;
    assert.equal(stopped.length, 1);
    await Promise.all(streams.slice(1).map(item => item.cleanup()));
    await fourthResult.cleanup();
    assert.equal(model.getAvailableSlotCount(), 3);
});

test('例外時も同時実行枠を返す', async () => {
    const model = new OfflineVideoApiModel(
        { startRecordedOfflineHLSStream: async () => { throw new Error('start failed'); }, stop: async () => {} },
        { findId: async () => video },
        { findId: async () => recorded },
        { getOriginalFilePath: async () => null, getOriginalMpeg2FilePath: async () => null },
    );
    await assert.rejects(() => model.startOfflineStream(7, 'profile'), /start failed/);
    assert.equal(model.getAvailableSlotCount(), 3);
});

test('MPEG-2 Original の対象ファイル解決を VideoApi へ委譲する', async () => {
    const { model } = makeModel();
    assert.deepEqual(await model.getOriginalMpeg2FilePath(7), { path: 'file-7' });
});

test('HEVC Original の対象ファイル解決を汎用 Original API へ委譲する', async () => {
    const { model } = makeModel();
    assert.deepEqual(await model.getOriginalFilePath(7), { path: 'file-7' });
});

test('MPEG-2 Original は録画中なら保存用ファイルを解決しない', async () => {
    const { model } = makeModel({ ...recorded, isRecording: true });
    await assert.rejects(() => model.getOriginalMpeg2FilePath(7), { message: 'RecordingVideoCannotBeSavedOffline' });
});
