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
    );
    await assert.rejects(() => model.startOfflineStream(7, 'profile'), /start failed/);
    assert.equal(model.getAvailableSlotCount(), 3);
});
