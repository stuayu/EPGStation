'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyServiceWorkerRequest } = require('../../client/serviceWorkerUtil');

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
