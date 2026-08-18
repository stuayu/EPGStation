'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const AmatsukazeRpcClient = require('../../dist/model/amatsukaze/AmatsukazeRpcClient').default;

const HEADER_SIZE = 6;
const RPC_ON_UI_DATA = 200;
const RPC_ON_CONSOLE_UPDATE = 201;
const RPC_REQUEST = 112;
const RPC_CHANGE_ITEM = 103;

/**
 * AmatsukazeServer と同じフレーム (ヘッダ 6 byte + チャンク列) を組み立てる
 */
const createFrame = (methodId, xml) => {
    const body = Buffer.from(xml, 'utf8');
    const chunkLength = Buffer.alloc(4);
    chunkLength.writeInt32LE(body.length, 0);
    const payload = Buffer.concat([chunkLength, body]);

    const header = Buffer.alloc(HEADER_SIZE);
    header.writeInt16LE(methodId, 0);
    header.writeInt32LE(payload.length, 2);

    return Buffer.concat([header, payload]);
};

/**
 * 受信したバイト列をフレームへ分解する (クライアントの送信内容を検証するため)
 */
const parseFrames = buffer => {
    const frames = [];
    let offset = 0;

    while (offset + HEADER_SIZE <= buffer.length) {
        const methodId = buffer.readInt16LE(offset);
        const payloadSize = buffer.readInt32LE(offset + 2);
        const payload = buffer.subarray(offset + HEADER_SIZE, offset + HEADER_SIZE + payloadSize);
        offset += HEADER_SIZE + payloadSize;

        const xml = payloadSize === 0 ? '' : payload.subarray(4).toString('utf8');
        frames.push({ methodId, xml });
    }

    return frames;
};

const UI_DATA_XML = [
    '<UIData xmlns="http://schemas.datacontract.org/2004/07/Amatsukaze.Server"',
    ' xmlns:i="http://www.w3.org/2001/XMLSchema-instance">',
    '<QueueData><Items><QueueItem>',
    '<Id>7</Id><SrcPath>D:\\rec\\a.ts</SrcPath><State>Encoding</State>',
    '<ConsoleId>1</ConsoleId><AddTime>2026-08-15T18:00:00+09:00</AddTime>',
    '<EncodeTime>PT2M30S</EncodeTime><ProfileName>HEVC</ProfileName>',
    '</QueueItem></Items></QueueData>',
    '<State><Progress>0.5</Progress><Running>true</Running></State>',
    '</UIData>',
].join('');

const CONSOLE_XML = [
    '<ConsoleUpdate xmlns="http://schemas.datacontract.org/2004/07/Amatsukaze.Server">',
    `<data>${Buffer.from('エンコード中 30%\nfps=25\n', 'utf8').toString('base64')}</data>`,
    '<index>1</index>',
    '</ConsoleUpdate>',
].join('');

/**
 * テスト用のスタブ AmatsukazeServer を立てる
 */
const startStubServer = () => {
    return new Promise(resolve => {
        const received = [];
        let socket = null;

        const server = net.createServer(connection => {
            socket = connection;
            connection.on('data', data => received.push(data));
        });

        // 接続直後に送信すると connection ハンドラより先に呼ばれることがあるため、
        // ソケットが確定するまで待ってから書き込む
        const waitForSocket = async () => {
            for (let i = 0; i < 400; i++) {
                if (socket !== null) {
                    return socket;
                }
                await new Promise(done => setTimeout(done, 5));
            }
            throw new Error('timeout waiting for connection');
        };

        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                getReceived: () => Buffer.concat(received),
                send: async buffer => (await waitForSocket()).write(buffer),
                destroySocket: async () => (await waitForSocket()).destroy(),
                close: () => new Promise(done => server.close(() => done())),
            });
        });
    });
};

const waitUntil = async predicate => {
    for (let i = 0; i < 400; i++) {
        if ((await predicate()) === true) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timeout waiting for condition');
};

test('接続して要求を送り、UIData / ConsoleUpdate を受け取れる', async () => {
    const server = await startStubServer();
    const client = new AmatsukazeRpcClient('127.0.0.1', server.port, 5000);
    const uiDataList = [];
    const consoleList = [];

    client.on('uiData', data => uiDataList.push(data));
    client.on('consoleUpdate', data => consoleList.push(data));

    await client.connect();
    await client.requestAll();

    // Queue / State / Console の 3 種類を 1 つずつ要求する
    await waitUntil(() => parseFrames(server.getReceived()).length === 3);
    const requests = parseFrames(server.getReceived());
    assert.deepEqual(
        requests.map(frame => frame.methodId),
        [RPC_REQUEST, RPC_REQUEST, RPC_REQUEST],
    );
    assert.match(requests[0].xml, /<ServerRequest[^>]*>Queue<\/ServerRequest>/);
    assert.match(requests[1].xml, /<ServerRequest[^>]*>State<\/ServerRequest>/);
    assert.match(requests[2].xml, /<ServerRequest[^>]*>Console<\/ServerRequest>/);

    await server.send(createFrame(RPC_ON_UI_DATA, UI_DATA_XML));
    await waitUntil(() => uiDataList.length === 1);

    const item = uiDataList[0].queueItems[0];
    assert.equal(item.id, 7);
    assert.equal(item.state, 'Encoding');
    assert.equal(item.consoleId, 1);
    assert.equal(item.profileName, 'HEVC');
    assert.equal(item.encodeTimeMs, 150000);
    assert.equal(item.addTime, Date.parse('2026-08-15T18:00:00+09:00'));
    assert.equal(uiDataList[0].state.progress, 0.5);
    assert.equal(uiDataList[0].state.running, true);

    await server.send(createFrame(RPC_ON_CONSOLE_UPDATE, CONSOLE_XML));
    await waitUntil(() => consoleList.length === 1);
    assert.equal(consoleList[0].index, 1);
    assert.deepEqual(consoleList[0].lines, ['エンコード中 30%', 'fps=25']);

    client.close();
    await server.close();
});

test('フレームが分割して届いても復元できる', async () => {
    const server = await startStubServer();
    const client = new AmatsukazeRpcClient('127.0.0.1', server.port, 5000);
    const uiDataList = [];
    client.on('uiData', data => uiDataList.push(data));

    await client.connect();

    // ヘッダの途中で切れるように分割して送る
    const frame = createFrame(RPC_ON_UI_DATA, UI_DATA_XML);
    await server.send(frame.subarray(0, 3));
    await new Promise(resolve => setTimeout(resolve, 20));
    await server.send(frame.subarray(3, 30));
    await new Promise(resolve => setTimeout(resolve, 20));
    await server.send(frame.subarray(30));

    await waitUntil(() => uiDataList.length === 1);
    assert.equal(uiDataList[0].queueItems[0].id, 7);

    client.close();
    await server.close();
});

test('複数フレームが 1 度に届いてもすべて処理する', async () => {
    const server = await startStubServer();
    const client = new AmatsukazeRpcClient('127.0.0.1', server.port, 5000);
    const uiDataList = [];
    client.on('uiData', data => uiDataList.push(data));

    await client.connect();
    await server.send(Buffer.concat([createFrame(RPC_ON_UI_DATA, UI_DATA_XML), createFrame(RPC_ON_UI_DATA, UI_DATA_XML)]));

    await waitUntil(() => uiDataList.length === 2);

    client.close();
    await server.close();
});

test('キューアイテムのキャンセルを ChangeItem として送る', async () => {
    const server = await startStubServer();
    const client = new AmatsukazeRpcClient('127.0.0.1', server.port, 5000);

    await client.connect();
    await client.changeItem(7, 'Cancel');

    await waitUntil(() => parseFrames(server.getReceived()).length === 1);
    const frame = parseFrames(server.getReceived())[0];
    assert.equal(frame.methodId, RPC_CHANGE_ITEM);
    assert.match(frame.xml, /<ChangeType>Cancel<\/ChangeType>/);
    assert.match(frame.xml, /<ItemId>7<\/ItemId>/);

    client.close();
    await server.close();
});

test('接続できないアドレスではエラーになる', async () => {
    // ポート 1 は使われていない (root 権限が要る well-known ポート)
    const client = new AmatsukazeRpcClient('127.0.0.1', 1, 2000);

    await assert.rejects(() => client.connect());
});

test('サーバから切断されると close イベントが出る', async () => {
    const server = await startStubServer();
    const client = new AmatsukazeRpcClient('127.0.0.1', server.port, 5000);
    let closed = false;
    client.on('close', () => {
        closed = true;
    });

    await client.connect();
    await server.destroySocket();

    await waitUntil(() => closed === true);
    assert.equal(closed, true);

    client.close();
    await server.close();
});

test('close() したあとは切断しても close イベントを出さない', async () => {
    const server = await startStubServer();
    const client = new AmatsukazeRpcClient('127.0.0.1', server.port, 5000);
    let closed = false;
    client.on('close', () => {
        closed = true;
    });

    await client.connect();
    client.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(closed, false);
    await server.close();
});
