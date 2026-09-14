'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyServiceWorkerRequest, createOfflineRangePlan, getOfflineChunkSlices, resolveOfflineByteRange } = require('../../client/serviceWorkerUtil');

const scope = 'https://example.test/epgstation/';
const request = (path, options = {}) => ({
    url: new URL(path, scope).toString(),
    method: 'GET',
    mode: 'cors',
    destination: '',
    ...options,
});

test('オフライン保存の仮想パスだけを Cache Storage 対象にする', () => {
    assert.equal(classifyServiceWorkerRequest(request('local/offline/7/gen/playlist.m3u8'), scope), 'offline');
});

test('アプリ本体の navigation と静的資産を分類する', () => {
    assert.equal(classifyServiceWorkerRequest(request('', { mode: 'navigate' }), scope), 'navigation');
    assert.equal(classifyServiceWorkerRequest(request('assets/index-abc.js', { destination: 'script' }), scope), 'asset');
    assert.equal(classifyServiceWorkerRequest(request('fonts/bml/font.woff2', { destination: 'font' }), scope), 'asset');
    assert.equal(classifyServiceWorkerRequest(request('manifest.json', { destination: 'manifest' }), scope), 'asset');
});

test('API、配信、socket.io、WebSocket、サムネイル API を横取りしない', () => {
    for (const path of ['api/config', 'api/thumbnails/1', 'api/dataBroadcasting/ws', 'api/sns/ws', 'streamfiles/1/2.ts', 'socket.io/?EIO=4']) {
        assert.equal(classifyServiceWorkerRequest(request(path, { mode: path.endsWith('/ws') ? 'websocket' : 'cors' }), scope), 'passthrough', path);
    }
});

test('別オリジン、POST、未知の要求を横取りしない', () => {
    assert.equal(classifyServiceWorkerRequest({ ...request('api/config'), method: 'POST' }, scope), 'passthrough');
    assert.equal(classifyServiceWorkerRequest({ ...request('other.js'), url: 'https://cdn.example/other.js', destination: 'script' }, scope), 'passthrough');
    assert.equal(classifyServiceWorkerRequest(request('local/other.bin'), scope), 'passthrough');
});

test('外部のニコニコ実況過去ログAPIはService Workerのcache対象外', () => {
    assert.equal(classifyServiceWorkerRequest(request('https://jikkyo.tsukumijima.net/api/kakolog/jk1'), scope), 'passthrough');
});

test('オフライン MPEG-2 Range の端点を 206 / 416 用に解決する', () => {
    assert.deepEqual(resolveOfflineByteRange('bytes=0-9', 20), { kind: 'partial', start: 0, end: 9 });
    assert.deepEqual(resolveOfflineByteRange('bytes=10-', 20), { kind: 'partial', start: 10, end: 19 });
    assert.deepEqual(resolveOfflineByteRange('bytes=-4', 20), { kind: 'partial', start: 16, end: 19 });
    assert.deepEqual(resolveOfflineByteRange('bytes=0-20', 20), { kind: 'unsatisfiable' });
    assert.deepEqual(resolveOfflineByteRange('bytes=20-', 20), { kind: 'unsatisfiable' });
    assert.deepEqual(resolveOfflineByteRange(undefined, 20), { kind: 'full', start: 0, end: 19 });
});

test('オフライン MPEG-2 Range はチャンク境界をまたいでスライスする', () => {
    assert.deepEqual(getOfflineChunkSlices({ start: 8, end: 25 }, 10, 30), [
        { chunkStart: 0, offset: 8, length: 2 },
        { chunkStart: 10, offset: 0, length: 10 },
        { chunkStart: 20, offset: 0, length: 6 },
    ]);
});

test('オフライン MPEG-2 応答計画は 206 と 416 のヘッダーを固定する', () => {
    const partial = createOfflineRangePlan('bytes=8-25', 30, 10);
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['Content-Range'], 'bytes 8-25/30');
    assert.equal(partial.headers['Content-Length'], '18');
    assert.equal(partial.slices.length, 3);
    const invalid = createOfflineRangePlan('bytes=30-', 30, 10);
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers['Content-Range'], 'bytes */30');
});

test('Range 無しの全体応答 (200) には Content-Range を付けない', () => {
    const full = createOfflineRangePlan(undefined, 30, 10);
    assert.equal(full.status, 200);
    assert.equal(full.headers['Content-Range'], undefined);
    assert.equal(full.headers['Content-Length'], '30');
    assert.equal(full.slices.length, 3);
});
