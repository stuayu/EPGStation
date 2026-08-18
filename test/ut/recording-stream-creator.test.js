'use strict';
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const test = require('node:test');
require('reflect-metadata');
const RecordingStreamCreator = require('../../dist/model/operator/recording/RecordingStreamCreator').default;

const logger = {
    system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} },
};

const reserve = overrides => ({
    id: 1,
    isConflict: true,
    programId: 12345,
    channelId: 67890,
    channelType: 'GR',
    channel: '13',
    startAt: 1780000000000,
    endAt: Date.now() + 10_000,
    allowEndLack: false,
    ...overrides,
});

test('programId 予約は共有 priority を変更せず service stream option を使う', async () => {
    const stream = new PassThrough();
    const calls = [];
    const client = {
        priority: 77,
        getServiceStream: async option => {
            calls.push(option);
            return stream;
        },
        getProgramStream: async () => {
            throw new Error('program stream must not be called');
        },
    };
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        { getConfig: () => ({ recPriority: 9, conflictPriority: 4, timeSpecifiedEndMargin: 1, recording: {} }) },
        { getClient: () => client },
    );
    const result = await creator.create(reserve());
    assert.equal(result, stream);
    assert.equal(client.priority, 77);
    assert.deepEqual(calls[0], { id: 67890, decode: true, priority: 4, signal: undefined });
    stream.destroy();
});

test('program mode を指定した場合だけ切り戻し用 program stream を使う', async () => {
    const stream = new PassThrough();
    let called = null;
    const client = {
        priority: 77,
        getProgramStream: async option => {
            called = option;
            return stream;
        },
        getServiceStream: async () => {
            throw new Error('service stream must not be called');
        },
    };
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                recPriority: 9,
                conflictPriority: 4,
                timeSpecifiedEndMargin: 1,
                recording: { programStreamMode: 'program' },
            }),
        },
        { getClient: () => client },
    );
    await creator.create(reserve({ id: 2 }));
    assert.deepEqual(called, { id: 12345, decode: true, priority: 4, signal: undefined });
    stream.destroy();
});

test('tuner 割当なし経路でも予定終了で取得済み service stream を閉じる', async () => {
    const stream = new PassThrough();
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        { getConfig: () => ({ recPriority: 9, conflictPriority: 4, timeSpecifiedEndMargin: 0, recording: {} }) },
        { getClient: () => ({ getServiceStream: async () => stream }) },
    );
    const result = await creator.create(reserve({ id: 3, isConflict: false, endAt: Date.now() + 20 }));
    assert.equal(result, stream);
    await new Promise(resolve => stream.once('close', resolve));
    assert.equal(creator.getCloseReason(stream), 'scheduled-end');
});

test('古い同一予約 stream の終了は新しい stream の終了タイマーを消さない', async () => {
    const streams = [new PassThrough(), new PassThrough()];
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        { getConfig: () => ({ recPriority: 9, conflictPriority: 4, timeSpecifiedEndMargin: 0, recording: {} }) },
        { getClient: () => ({ getServiceStream: async () => streams.shift() }) },
    );
    const first = await creator.create(reserve({ id: 4, endAt: Date.now() + 10_000 }));
    const second = await creator.create(reserve({ id: 4, endAt: Date.now() + 30 }));
    first.destroy();
    await new Promise(resolve => second.once('close', resolve));
    assert.equal(creator.getCloseReason(second), 'scheduled-end');
});

test('legacy program stream は Mirakurun の終了境界を維持しハードタイマーを追加しない', async () => {
    const stream = new PassThrough();
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                recPriority: 9,
                conflictPriority: 4,
                timeSpecifiedEndMargin: 0,
                recording: { programStreamMode: 'program' },
            }),
        },
        { getClient: () => ({ getProgramStream: async () => stream }) },
    );
    await creator.create(reserve({ id: 5, endAt: Date.now() + 10 }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(stream.destroyed, false);
    assert.throws(() => creator.changeEndAt(reserve({ id: 5 })), /StreamChangeAtError/);
    stream.destroy();
});
