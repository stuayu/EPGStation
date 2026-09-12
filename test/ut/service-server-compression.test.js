'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const { shouldCompressRequest } = require('../../dist/model/service/ServiceServer');

test('圧縮判定は通常の API と静的アセットを対象にする', () => {
    assert.equal(shouldCompressRequest('/api/programs'), true);
    assert.equal(shouldCompressRequest('/assets/app.js'), true);
});

test('圧縮判定はストリーミング系と WebSocket 系を除外する', () => {
    for (const pathname of [
        '/streamfiles/stream1.m3u8',
        '/api/streams/live/1/hls',
        '/api/videos/1',
        '/socket.io/',
        '/api/dataBroadcasting/ws',
        '/api/sns/ws',
    ]) {
        assert.equal(shouldCompressRequest(pathname), false, pathname);
    }
});
