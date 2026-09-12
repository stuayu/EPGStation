'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { PassThrough } = require('node:stream');
const LiveStreamSourceManageModel = require('../../dist/model/service/stream/manager/LiveStreamSourceManageModel').default;

const logger = {
    getLogger: () => ({
        stream: { info: () => {}, debug: () => {} },
        system: { error: () => {} },
    }),
};

function makeManager(getServiceStream) {
    const mirakurun = { priority: 0, getServiceStream };

    return {
        manager: new LiveStreamSourceManageModel(logger, { getClient: () => mirakurun }),
        mirakurun,
    };
}

function waitForData(stream) {
    return new Promise(resolve => stream.once('data', resolve));
}

test('同じ channelId のライブ受信は1本を複数の配信枝へ分岐する', async () => {
    const upstream = new PassThrough();
    let calls = 0;
    const { manager, mirakurun } = makeManager(async () => {
        calls++;

        return upstream;
    });

    const first = await manager.acquire(101, 7);
    const second = await manager.acquire(101, 7);
    const firstData = waitForData(first.stream);
    const secondData = waitForData(second.stream);
    upstream.write(Buffer.from('shared-ts'));

    assert.equal((await firstData).toString(), 'shared-ts');
    assert.equal((await secondData).toString(), 'shared-ts');
    assert.equal(calls, 1);
    assert.equal(mirakurun.priority, 7);

    first.release();
    first.release();
    assert.equal(upstream.destroyed, false);
    second.release();
    assert.equal(upstream.destroyed, true);
});

test('共有受信の開始中に参加した配信もMirakurun接続を共有する', async () => {
    let resolveStream;
    const opening = new Promise(resolve => {
        resolveStream = resolve;
    });
    const upstream = new PassThrough();
    let calls = 0;
    const { manager } = makeManager(async () => {
        calls++;

        return opening;
    });

    const firstPromise = manager.acquire(202, 3);
    const secondPromise = manager.acquire(202, 3);
    resolveStream(upstream);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    assert.equal(calls, 1);
    first.release();
    second.release();
    assert.equal(upstream.destroyed, true);
});

test('channelId が違うライブ受信は共有せず、最後のleaseだけが上流を閉じる', async () => {
    const upstreams = new Map();
    let calls = 0;
    const { manager } = makeManager(async channelId => {
        calls++;
        const upstream = new PassThrough();
        upstreams.set(channelId, upstream);

        return upstream;
    });

    const first = await manager.acquire(301, 1);
    const second = await manager.acquire(302, 1);
    assert.equal(calls, 2);
    assert.notEqual(first.stream, second.stream);

    first.release();
    assert.equal(upstreams.get(301).destroyed, true);
    assert.equal(upstreams.get(302).destroyed, false);
    second.release();
    assert.equal(upstreams.get(302).destroyed, true);
});

test('Mirakurun接続失敗後は同じchannelIdを再試行できる', async () => {
    let calls = 0;
    const upstream = new PassThrough();
    const { manager } = makeManager(async () => {
        calls++;
        if (calls === 1) throw new Error('connect failed');

        return upstream;
    });

    await assert.rejects(manager.acquire(401, 1), /connect failed/);
    const lease = await manager.acquire(401, 1);
    assert.equal(calls, 2);
    lease.release();
});

test('共有上流の終了後は新しいMirakurun受信を開く', async () => {
    const upstreams = [];
    let calls = 0;
    const { manager } = makeManager(async () => {
        calls++;
        const upstream = new PassThrough();
        upstreams.push(upstream);

        return upstream;
    });

    const first = await manager.acquire(501, 1);
    upstreams[0].end();
    await new Promise(resolve => upstreams[0].once('close', resolve));
    first.release();

    const second = await manager.acquire(501, 1);
    assert.equal(calls, 2);
    second.release();
});
