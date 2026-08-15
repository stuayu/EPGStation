'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const EncoderModel = require('../../dist/model/service/encode/EncoderModel').default;

// エンコードプロセスの標準エラー出力を、失敗時に error として出し直せるようにする処理を検証する。
// 標準エラーには進捗表示が延々と流れてくるため通常は debug でしか残さないが、
// それだと既定のログレベル (info) では失敗理由まで捨てられ、
// encode.log に終了コードしか残らず原因が追えなくなる。

const createEncoder = () => {
    const errors = [];
    const logger = {
        getLogger: () => ({
            system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            encode: {
                info: () => {},
                warn: () => {},
                error: message => {
                    errors.push(message);
                },
                debug: () => {},
            },
        }),
    };

    // DI する依存はどれもここで検証する処理からは呼ばれないため空実装でよい
    return { encoder: new EncoderModel(logger, {}, {}, {}, {}, {}, {}, {}, {}, {}), errors: errors };
};

test('標準エラーの内容を行単位で控える', () => {
    const { encoder, errors } = createEncoder();

    encoder.addStderrLog('first line\nsecond line\n');
    encoder.logStderr();

    assert.deepEqual(errors, ['encode process stderr (last 2 lines):', '  first line', '  second line']);
});

test('空行と前後の空白は捨てる (進捗表示の改行だけが残らないようにする)', () => {
    const { encoder, errors } = createEncoder();

    encoder.addStderrLog('\r\n   \r\n  message  \r\n');
    encoder.logStderr();

    assert.deepEqual(errors, ['encode process stderr (last 1 lines):', '  message']);
});

test('保持するのは直近 STDERR_LOG_LINES 行だけ', () => {
    const { encoder, errors } = createEncoder();

    const total = EncoderModel.STDERR_LOG_LINES + 5;
    for (let i = 0; i < total; i++) {
        encoder.addStderrLog(`line ${i}\n`);
    }
    encoder.logStderr();

    assert.equal(errors.length, EncoderModel.STDERR_LOG_LINES + 1);
    assert.equal(errors[0], `encode process stderr (last ${EncoderModel.STDERR_LOG_LINES} lines):`);
    // 古い行は落ち、末尾の行が残る
    assert.equal(errors[1], `  line ${total - EncoderModel.STDERR_LOG_LINES}`);
    assert.equal(errors[errors.length - 1], `  line ${total - 1}`);
});

test('標準エラーが空なら何も出さない', () => {
    const { encoder, errors } = createEncoder();

    encoder.logStderr();

    assert.deepEqual(errors, []);
});
