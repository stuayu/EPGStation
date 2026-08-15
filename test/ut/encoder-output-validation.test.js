'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EncoderModel = require('../../dist/model/service/encode/EncoderModel').default;

// エンコード結果が動画として成立しているかの判定を検証する。
// 保存先の空き容量が尽きた場合、外部エンコーダ (Amatsukaze / tsreplace など) は
// 書き込みに失敗しても終了コード 0 で終わることがある。ここで弾けないと
// 0 バイトのファイルが「エンコード済み」として登録され、removeOriginal が有効なら
// 元の録画 TS まで削除されてしまう。

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        encode: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }),
};

// DI する依存はどれも isValidOutputFile() からは呼ばれないため空実装でよい
const createEncoder = () => new EncoderModel(logger, {}, {}, {}, {}, {}, {}, {}, {}, {});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-encoder-'));
const writeFile = (name, size) => {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, Buffer.alloc(size));

    return filePath;
};

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('0 バイトの出力は失敗として扱う (ディスクフル時の典型)', async () => {
    const encoder = createEncoder();

    assert.equal(await encoder.isValidOutputFile(writeFile('empty.ts', 0)), false);
});

test('数百バイトの出力も失敗として扱う (書き込み途中で切れたファイル)', async () => {
    const encoder = createEncoder();

    assert.equal(await encoder.isValidOutputFile(writeFile('truncated.ts', 565)), false);
});

test('出力ファイルが存在しない場合も失敗として扱う', async () => {
    const encoder = createEncoder();

    assert.equal(await encoder.isValidOutputFile(path.join(tmpDir, 'notfound.ts')), false);
});

test('下限を超えた出力は成功として扱う', async () => {
    const encoder = createEncoder();

    assert.equal(await encoder.isValidOutputFile(writeFile('ok.ts', EncoderModel.MIN_OUTPUT_FILE_SIZE)), true);
});

test('出力ファイルを作らないエンコード (null) は判定対象外', async () => {
    const encoder = createEncoder();

    assert.equal(await encoder.isValidOutputFile(null), true);
});
