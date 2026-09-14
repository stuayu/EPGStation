'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createOriginalMpeg2Command, isOriginalMpeg2Source } = require('../../dist/util/OriginalMpeg2Util');
const { attachFileStreamLifecycle, responseFile } = require('../../dist/model/service/api');
const { parseByteRangeHeader } = require('../../dist/util/HttpRangeUtil');
const { isPlaybackGenerationCurrent } = require('../../dist/util/PlaybackGenerationUtil');
const { shouldPreservePausedPlayback } = require('../../dist/util/PlaybackPauseIntentUtil');
const { shouldAutoplayPlayback } = require('../../dist/util/PlaybackAutoplayUtil');
const { applyPlaybackSeekAction, resolvePlaybackSeekAction } = require('../../dist/util/PlaybackSeekIntentUtil');
const { isValidPlaybackSyncPosition } = require('../../dist/util/PlaybackSyncPositionUtil');

test('ライブ MPEG-2 直配信は tsreadex 設定時だけ -b 7 の正規化 cmd を作る', () => {
    assert.match(createOriginalMpeg2Command('live', 'C:/tools/tsreadex.exe'), /%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 -/);
    assert.equal(createOriginalMpeg2Command('live'), undefined);
});

test('録画 MPEG-2 直配信は tsreadex の有無に関係なく Range ファイル直配信 cmd を持たない', () => {
    assert.equal(createOriginalMpeg2Command('recorded', 'tsreadex'), undefined);
    assert.equal(createOriginalMpeg2Command('recorded'), undefined);
});

test('MPEG-2 TS 以外は Original MPEG-2 対象外', () => {
    assert.equal(isOriginalMpeg2Source({ codec: 'mpeg2', transport: 'mpegts' }), true);
    assert.equal(isOriginalMpeg2Source({ codec: 'h264', transport: 'mpegts' }), false);
    assert.equal(isOriginalMpeg2Source({ codec: 'mpeg2', transport: 'mp4' }), false);
    assert.equal(isOriginalMpeg2Source({ codec: 'mpeg2', transport: 'mmt-tlv' }), false);
});

test('Range seek のレスポンス切断で旧 ReadStream を destroy する', () => {
    const readable = new EventEmitter();
    readable.destroyed = false;
    let destroyed = 0;
    readable.destroy = () => {
        readable.destroyed = true;
        destroyed++;
    };
    const response = new EventEmitter();
    response.writableEnded = false;
    attachFileStreamLifecycle(readable, response);
    response.emit('close');
    response.emit('close');
    assert.equal(destroyed, 1);
});

test('Range file の正常 EOF でも ReadStream を回収する', () => {
    const readable = new EventEmitter();
    readable.destroyed = false;
    let destroyed = 0;
    readable.destroy = () => {
        readable.destroyed = true;
        destroyed++;
    };
    const response = new EventEmitter();
    response.writableEnded = true;
    attachFileStreamLifecycle(readable, response);
    readable.emit('end');
    assert.equal(destroyed, 1);
});

test('Range はファイル長を超える指定を unsatisfiable と判定する', () => {
    assert.deepEqual(parseByteRangeHeader('bytes=10-20', 20), { kind: 'unsatisfiable' });
    assert.deepEqual(parseByteRangeHeader('bytes=0-19', 20), { kind: 'valid', range: { start: 0, end: 19 } });
    assert.deepEqual(parseByteRangeHeader('bytes=-4', 20), { kind: 'valid', range: { start: 16, end: 19 } });
});

test('Range が無い場合と不正な複数 Range を区別する', () => {
    assert.deepEqual(parseByteRangeHeader(undefined, 20), { kind: 'none' });
    assert.deepEqual(parseByteRangeHeader('bytes=0-1,2-3', 20), { kind: 'unsatisfiable' });
});

test('ファイル長を超える HTTP Range は 416 と Content-Range bytes */size を返す', () => {
    const filePath = path.join('/private/tmp', `epgstation-range-${process.pid}-${Date.now()}.ts`);
    fs.writeFileSync(filePath, Buffer.alloc(10));
    try {
        const response = {
            statusCode: 0,
            headers: {},
            status(code) {
                this.statusCode = code;
            },
            set(headers) {
                Object.assign(this.headers, headers);
            },
            end() {},
        };
        responseFile({ method: 'GET', headers: { range: 'bytes=10-' } }, response, filePath, 'video/mp2t');
        assert.equal(response.statusCode, 416);
        assert.equal(response.headers['Content-Range'], 'bytes */10');
    } finally {
        fs.unlinkSync(filePath);
    }
});

test('古いプレイヤー世代の非同期処理は現在世代ではない', () => {
    assert.equal(isPlaybackGenerationCurrent(3, 3), true);
    assert.equal(isPlaybackGenerationCurrent(3, 4), false);
});

test('ライブ停滞の自動再生成だけ利用者の一時停止意図を引き継ぐ', () => {
    assert.equal(shouldPreservePausedPlayback(true, 'live-idle'), true);
    assert.equal(shouldPreservePausedPlayback(true, 'live-stall'), true);
    assert.equal(shouldPreservePausedPlayback(true, 'media-error'), false);
    assert.equal(shouldPreservePausedPlayback(true, 'offline'), false);
    assert.equal(shouldPreservePausedPlayback(true, 'pip-resume'), false);
    assert.equal(shouldPreservePausedPlayback(true, 'manual'), false);
});

test('再生中にシークしたら再生を続ける', () => {
    const calls = [];
    applyPlaybackSeekAction(true, { play: () => calls.push('play'), pause: () => calls.push('pause') });
    assert.deepEqual(calls, ['play']);
    assert.equal(resolvePlaybackSeekAction(true), 'play');
});

test('一時停止中にシークしたら一時停止を維持する', () => {
    const calls = [];
    applyPlaybackSeekAction(false, { play: () => calls.push('play'), pause: () => calls.push('pause') });
    assert.deepEqual(calls, ['pause']);
    assert.equal(resolvePlaybackSeekAction(false), 'pause');
});

test('シーク前状態を指定しない場合は再生状態を変更しない', () => {
    const calls = [];
    applyPlaybackSeekAction(undefined, { play: () => calls.push('play'), pause: () => calls.push('pause') });
    assert.deepEqual(calls, []);
    assert.equal(resolvePlaybackSeekAction(undefined), 'preserve');
});

test('録画 MPEG-2 の開始時自動再生条件は M2TS-LL と同じ', () => {
    assert.equal(shouldAutoplayPlayback(false, false), true);
    assert.equal(shouldAutoplayPlayback(true, false), false);
    assert.equal(shouldAutoplayPlayback(false, true), false);
});

test('同期位置は有限かつ非負のときだけ video へ渡せる', () => {
    assert.equal(isValidPlaybackSyncPosition(0), true);
    assert.equal(isValidPlaybackSyncPosition(1.25), true);
    assert.equal(isValidPlaybackSyncPosition(-0.01), false);
    assert.equal(isValidPlaybackSyncPosition(Number.NaN), false);
    assert.equal(isValidPlaybackSyncPosition(Number.POSITIVE_INFINITY), false);
});

test('リクエスト aborted でも Range ReadStream を destroy する', () => {
    const readable = new EventEmitter();
    readable.destroyed = false;
    let destroyed = 0;
    readable.destroy = () => {
        readable.destroyed = true;
        destroyed++;
    };
    const response = new EventEmitter();
    response.writableEnded = false;
    const request = new EventEmitter();
    attachFileStreamLifecycle(readable, response, request);
    request.emit('aborted');
    request.emit('close');
    assert.equal(destroyed, 1);
});
