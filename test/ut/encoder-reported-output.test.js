'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const EncoderModel = require('../../dist/model/service/encode/EncoderModel').default;

// 出力先を自分で決めるエンコードコマンド (Amatsukaze 連携) は、
// 標準出力へ {"type":"output","path":"..."} を出して実際の出力先を知らせる。
// Amatsukaze は出力先ディレクトリしか受け付けず、ファイル名は入力 TS から自分で決めて
// 同名があれば上書きするため、EPGStation が用意した %OUTPUT% と食い違うことがある。

const createEncoder = () => {
    const logger = {
        getLogger: () => ({
            system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            encode: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        }),
    };

    const encoder = new EncoderModel(logger, {}, {}, {}, {}, {}, {}, {}, {}, {});
    // updateEncodingProgressInfo は encodeOption が無いと何もしない
    encoder.encodeOption = { encodeId: 1, mode: 'test' };
    encoder.encodeEvent = { emitUpdateEncodeProgress: () => {} };

    return encoder;
};

test('output メッセージで実際の出力先を受け取る', () => {
    const encoder = createEncoder();

    encoder.updateEncodingProgressInfo(JSON.stringify({ type: 'output', path: 'D:\\out\\program.hevc.ts' }) + '\n');

    assert.equal(encoder.reportedOutputFilePath, 'D:\\out\\program.hevc.ts');
});

test('progress メッセージは出力先を書き換えない', () => {
    const encoder = createEncoder();

    encoder.updateEncodingProgressInfo(JSON.stringify({ type: 'progress', percent: 0.5, log: 'encoding' }) + '\n');

    assert.equal(encoder.reportedOutputFilePath, null);
    assert.equal(encoder.progressInfo.percent, 0.5);
});

test('path が文字列でない output メッセージは無視する', () => {
    const encoder = createEncoder();

    encoder.updateEncodingProgressInfo(JSON.stringify({ type: 'output', path: 123 }) + '\n');

    assert.equal(encoder.reportedOutputFilePath, null);
});

test('progress と output が同じチャンクで来ても両方処理する', () => {
    const encoder = createEncoder();

    const data =
        JSON.stringify({ type: 'progress', percent: 1, log: 'done' }) +
        '\n' +
        JSON.stringify({ type: 'output', path: 'D:\\out\\program(1).hevc.ts' }) +
        '\n';
    encoder.updateEncodingProgressInfo(data);

    assert.equal(encoder.progressInfo.percent, 1);
    assert.equal(encoder.reportedOutputFilePath, 'D:\\out\\program(1).hevc.ts');
});
