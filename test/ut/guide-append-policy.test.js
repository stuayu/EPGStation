'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

test('単局番組表は時間軸を24時間に保ち、EPG末尾で範囲を進めない', async () => {
    const { resolveSingleStationAppend } = await import('../../client/src/util/GuideAppendPolicy.mjs');
    const startAt = 1_800_000_000_000;
    assert.deepEqual(resolveSingleStationAppend({ startAt, days: 8, added: 1 }), {
        endAt: startAt + 8 * 24 * 60 * 60 * 1000,
        timeLength: 24,
    });
    assert.equal(resolveSingleStationAppend({ startAt, days: 8, added: 0 }), null);
});
