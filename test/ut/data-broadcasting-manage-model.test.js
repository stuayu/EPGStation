'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

const DataBroadcastingManageModel = require('../../dist/model/service/dataBroadcasting/DataBroadcastingManageModel').default;
const webBml = require('../../dist/model/service/dataBroadcasting/webBml');

// DataBroadcastingManageModel のテスト。
// 実際の TS 解析 (web-bml の decodeTS) は持ち込まず、__setDecodeTSForTest でスタブの Transform に
// 差し替えて、登録上限・backpressure の間引き・後始末の配線だけを検証する。

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

function makeLogger() {
    return {
        getLogger: () => ({
            system: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
            access: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
            stream: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
            encode: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
        }),
    };
}

function makeConfiguration(overrides) {
    return {
        getConfig: () => ({
            streamingPriority: 0,
            ...overrides,
        }),
    };
}

function makeFakeWs() {
    const emitter = new EventEmitter();
    emitter.OPEN = OPEN;
    emitter.CONNECTING = CONNECTING;
    emitter.CLOSED = CLOSED;
    emitter.readyState = OPEN;
    emitter.bufferedAmount = 0;
    emitter.sent = [];
    emitter.closedWith = null;
    emitter.send = data => {
        emitter.sent.push(data);
    };
    emitter.close = (code, reason) => {
        emitter.closedWith = { code, reason };
        emitter.readyState = CLOSED;
    };

    return emitter;
}

function makeChannelDB(channel) {
    return {
        findId: async () => channel,
    };
}

function makeMirakurunClientModel(streamFactory) {
    return {
        getClient: () => ({
            priority: 0,
            getServiceStream: async () => streamFactory(),
        }),
    };
}

function makeVideoUtil(pathResolver) {
    return {
        getFullFilePathFromId: async id => pathResolver(id),
        getFullFilePathFromVideoFile: () => null,
        getParentDirPath: () => null,
        getInfo: async () => ({ duration: 0, size: 0, bitRate: 0 }),
        getDetailedInfo: async () => ({
            duration: 0,
            size: 0,
            bitRate: 0,
            startTime: null,
            videoCodec: null,
            audioCodec: null,
            width: null,
            height: null,
        }),
    };
}

/**
 * decodeTS のスタブ。実際の TS 解析は行わず、options.sendCallback を呼び出し元へ渡すだけの
 * PassThrough を返す。テストは capturedCallbacks 経由で送信メッセージを模擬できる
 */
function makeStubDecodeTS(capturedCallbacks) {
    return options => {
        capturedCallbacks.push(options.sendCallback);
        const t = new PassThrough({ objectMode: false });

        return t;
    };
}

function setupModel({ maxStreams, decodeTS, channel = { id: 1 }, filePath = '/tmp/dummy.ts' } = {}) {
    const capturedCallbacks = [];
    if (typeof decodeTS === 'undefined') {
        decodeTS = makeStubDecodeTS(capturedCallbacks);
    }
    webBml.__setDecodeTSForTest(decodeTS);

    const model = new DataBroadcastingManageModel(
        makeLogger(),
        makeConfiguration(typeof maxStreams === 'number' ? { dataBroadcasting: { maxStreams } } : {}),
        makeChannelDB(channel),
        makeMirakurunClientModel(() => new PassThrough()),
        makeVideoUtil(() => filePath),
    );

    return { model, capturedCallbacks };
}

test.afterEach(() => {
    webBml.__setDecodeTSForTest(undefined);
});

test('closes with 1011 when the channel cannot be resolved', async () => {
    const { model } = setupModel({ channel: null });
    const ws = makeFakeWs();

    await model.start(ws, { type: 'epgStationLive', channelId: 999 });

    assert.equal(ws.closedWith.code, 1011);
});

test('evicts the oldest stream once the configured max is exceeded', async () => {
    const { model } = setupModel({ maxStreams: 2 });
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    const ws3 = makeFakeWs();

    await model.start(ws1, { type: 'epgStationLive', channelId: 1 });
    await model.start(ws2, { type: 'epgStationLive', channelId: 1 });
    await model.start(ws3, { type: 'epgStationLive', channelId: 1 });

    // 最古 (ws1) はエラーを受け取って閉じられる
    assert.equal(ws1.closedWith.code, 4000);
    assert.equal(ws1.sent.length, 1);
    assert.equal(JSON.parse(ws1.sent[0]).type, 'error');

    // ws2 / ws3 はまだ生きている
    assert.equal(ws2.closedWith, null);
    assert.equal(ws3.closedWith, null);
});

test('drops low-priority messages while backpressure exceeds the drop threshold', async () => {
    const { model, capturedCallbacks } = setupModel();
    const ws = makeFakeWs();

    await model.start(ws, { type: 'epgStationLive', channelId: 1 });
    ws.bufferedAmount = 9 * 1024 * 1024; // > 8MB drop threshold, < 32MB close threshold

    const send = capturedCallbacks[0];
    send({ type: 'pcr', pcrBase: 1, pcrExtension: 0 });
    assert.equal(ws.sent.length, 0, 'pcr should be dropped under backpressure');

    send({ type: 'moduleDownloaded', componentId: 1, moduleId: 1, files: [], version: 1, dataEventId: 1 });
    assert.equal(ws.sent.length, 1, 'moduleDownloaded must always be sent');
    assert.equal(ws.closedWith, null);
});

test('closes the stream once backpressure exceeds the close threshold', async () => {
    const { model, capturedCallbacks } = setupModel();
    const ws = makeFakeWs();

    await model.start(ws, { type: 'epgStationLive', channelId: 1 });
    ws.bufferedAmount = 40 * 1024 * 1024; // > 32MB close threshold

    const send = capturedCallbacks[0];
    send({ type: 'pcr', pcrBase: 1, pcrExtension: 0 });

    assert.equal(ws.sent.length, 0);
    assert.equal(ws.closedWith.code, 4000);
});

test('cleans up when the websocket closes', async () => {
    const { model } = setupModel();
    const ws = makeFakeWs();

    await model.start(ws, { type: 'epgStationLive', channelId: 1 });
    ws.emit('close');

    // 2 度目の close は no-op (既に閉じている)
    ws.closedWith = null;
    ws.emit('close');
    assert.equal(ws.closedWith, null);
});

test('closes the websocket when the source stream ends (e.g. recorded file EOF)', async () => {
    let readStream;
    const decodeTS = () => new PassThrough();
    webBml.__setDecodeTSForTest(decodeTS);

    const model = new DataBroadcastingManageModel(
        makeLogger(),
        makeConfiguration(),
        makeChannelDB({ id: 1 }),
        makeMirakurunClientModel(() => {
            readStream = new PassThrough();

            return readStream;
        }),
        makeVideoUtil(() => '/tmp/dummy.ts'),
    );

    const ws = makeFakeWs();
    await model.start(ws, { type: 'epgStationLive', channelId: 1 });

    readStream.emit('close');

    assert.equal(ws.closedWith.code, 4000);
});
