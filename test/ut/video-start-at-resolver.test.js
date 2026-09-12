'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveVideoStartAt } = require('../../dist/util/VideoStartAtResolver');

test('動画先頭時刻の根拠を TS、元録画、番組時刻、更新日時の順で選ぶ', () => {
    const recordedStartAt = 1700000000000;
    assert.equal(
        resolveVideoStartAt({
            tsStartAt: recordedStartAt + 1000,
            associatedStartAt: recordedStartAt + 2000,
            recordedStartAt,
            recordingStartMarginMs: 5000,
            fileMtimeMs: recordedStartAt + 1805000,
            durationSec: 1800,
        }),
        recordedStartAt + 1000,
    );
    assert.equal(
        resolveVideoStartAt({
            associatedStartAt: recordedStartAt + 2000,
            recordedStartAt,
            recordingStartMarginMs: 5000,
            fileMtimeMs: recordedStartAt + 1805000,
            durationSec: 1800,
        }),
        recordedStartAt + 2000,
    );
    assert.equal(
        resolveVideoStartAt({
            recordedStartAt,
            recordingStartMarginMs: 5000,
            fileMtimeMs: recordedStartAt + 1805000,
            durationSec: 1800,
        }),
        recordedStartAt - 5000,
    );
    assert.equal(
        resolveVideoStartAt({ fileMtimeMs: recordedStartAt + 1805000, durationSec: 1800 }),
        recordedStartAt + 5000,
    );
});

test('不正な根拠は無視して null を返す', () => {
    assert.equal(resolveVideoStartAt({ tsStartAt: Number.NaN, fileMtimeMs: 1, durationSec: 0 }), null);
});
