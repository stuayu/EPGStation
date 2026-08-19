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
    // legacy は Mirakurun が終了境界を持つので、endAt 変更は何もせず投げもしない
    assert.doesNotThrow(() => creator.changeEndAt(reserve({ id: 5, endAt: Date.now() + 10 })));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(stream.destroyed, false, 'ハードタイマーを追加していない');
    stream.destroy();
});

test('stream 取得前の endAt 変更 (準備中の延長) は投げずに覚えておく', () => {
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        { getConfig: () => ({ recPriority: 9, conflictPriority: 4, timeSpecifiedEndMargin: 1, recording: {} }) },
        { getClient: () => ({}) },
    );
    // 以前は StreamChangeAtError を投げていた。呼び出し側を待たせないため投げない
    const extended = Date.now() + 600_000;
    assert.doesNotThrow(() => creator.changeEndAt(reserve({ id: 42, endAt: extended })));
    assert.equal(creator.pendingEndAt[42], extended, '新しい endAt を覚えている');
});

test('準備中に延長された endAt が stream 取得時のハードタイマーへ反映される', async () => {
    const stream = new PassThrough();
    const client = { priority: 0, getServiceStream: async () => stream };
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        { getConfig: () => ({ recPriority: 9, conflictPriority: 4, timeSpecifiedEndMargin: 1, recording: {} }) },
        { getClient: () => client },
    );

    const original = reserve({ id: 7, endAt: Date.now() + 300 });
    const extendedEndAt = Date.now() + 3600_000;

    // stream 取得より先に延長が届く
    creator.changeEndAt({ ...original, endAt: extendedEndAt });
    await creator.create(original);

    // 旧 endAt (300ms 後) で閉じられていないこと
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(stream.destroyed, false, '古い endAt でストリームが閉じられていない');
    assert.equal(creator.getCloseReason(stream), null);
    assert.equal(creator.pendingEndAt[7], undefined, '反映後は保留を消す');

    stream.destroy();
});

test('stream 取得後の endAt 変更はそのままハードタイマーを張り直す', async () => {
    const stream = new PassThrough();
    const client = { priority: 0, getServiceStream: async () => stream };
    const creator = new RecordingStreamCreator(
        { getLogger: () => logger },
        { getConfig: () => ({ recPriority: 9, conflictPriority: 4, timeSpecifiedEndMargin: 1, recording: {} }) },
        { getClient: () => client },
    );

    const original = reserve({ id: 8, endAt: Date.now() + 300 });
    await creator.create(original);
    creator.changeEndAt({ ...original, endAt: Date.now() + 3600_000 });

    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(stream.destroyed, false, '延長後は古い endAt で閉じない');
    stream.destroy();
});
