'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveOfflineJikkyoParam } = require('../../dist/util/OfflineJikkyoParam');

const stored = {
    jikkyoChannelId: 'jk1',
    jikkyoStartAt: 1789000000000,
    jikkyoEndAt: 1789000060000,
};

test('オンラインなら保存済み実況パラメータを優先する', () => {
    assert.deepEqual(resolveOfflineJikkyoParam(stored, true, { ...stored, jikkyoChannelId: 'jk2' }), {
        source: 'stored',
        param: stored,
    });
});

test('旧形式レコードは実況無しとしてサーバー解決値へフォールバックする', () => {
    const oldRecord = { videoId: 10, generationId: 'old', profile: 'hls' };
    assert.deepEqual(resolveOfflineJikkyoParam(oldRecord, true, stored), { source: 'server', param: stored });
});

test('旧形式レコードをオフラインで読んだ場合は実況を出さない', () => {
    const oldRecord = { videoId: 10, generationId: 'old', profile: 'hls' };
    assert.deepEqual(resolveOfflineJikkyoParam(oldRecord, false, stored), { source: 'none', param: null });
});

test('実況範囲が不正なら保存済み値もサーバー値も使わない', () => {
    assert.deepEqual(resolveOfflineJikkyoParam({ ...stored, jikkyoEndAt: stored.jikkyoStartAt }, true, null), {
        source: 'none',
        param: null,
    });
});
