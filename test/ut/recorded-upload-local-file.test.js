'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Model = require('../../dist/model/api/recorded/RecordedApiModel').default;

// サーバー上のファイル指定 (localFilePath) は importDirs 配下に限定される。
// 指定ファイルは録画ディレクトリへ移動されるため、配下判定を誤ると無関係なファイルを動かせてしまう
const makeModel = (importDirs, calls) =>
    new Model(
        { recorded: { addUploadedVideoFile: async option => (calls.push(option), 1) } },
        {},
        {},
        {},
        { getConfig: () => ({ importDirs }) },
        {},
        {},
        {},
        {},
        {},
    );

const makeTempDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-upload-')));

test('addUploadedVideoFile accepts a file under importDirs', async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'sample.ts');
    fs.writeFileSync(filePath, 'dummy');

    const calls = [];
    const model = makeModel([{ name: 'import', path: dir }], calls);
    await model.addUploadedVideoFile({
        parentDirectoryName: 'recorded',
        viewName: 'sample.ts',
        fileType: 'ts',
        localFilePath: filePath,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].localFilePath, filePath);
});

test('addUploadedVideoFile rejects a file outside importDirs', async () => {
    const dir = makeTempDir();
    const outsideDir = makeTempDir();
    const filePath = path.join(outsideDir, 'sample.ts');
    fs.writeFileSync(filePath, 'dummy');

    const calls = [];
    const model = makeModel([{ name: 'import', path: dir }], calls);
    await assert.rejects(
        () =>
            model.addUploadedVideoFile({
                parentDirectoryName: 'recorded',
                viewName: 'sample.ts',
                fileType: 'ts',
                localFilePath: filePath,
            }),
        /ImportPathNotAllowed/,
    );
    assert.equal(calls.length, 0);
});

test('addUploadedVideoFile rejects localFilePath when importDirs is not configured', async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'sample.ts');
    fs.writeFileSync(filePath, 'dummy');

    const calls = [];
    const model = makeModel(undefined, calls);
    await assert.rejects(
        () =>
            model.addUploadedVideoFile({
                parentDirectoryName: 'recorded',
                viewName: 'sample.ts',
                fileType: 'ts',
                localFilePath: filePath,
            }),
        /ImportDirsNotConfigured/,
    );
    assert.equal(calls.length, 0);
});

test('scanImportDirectory with analyze false lists files without ts analysis', async () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'sample.ts'), 'dummy');

    let analyzed = 0;
    const model = new Model(
        {},
        {},
        {},
        {},
        { getConfig: () => ({ importDirs: [{ name: 'import', path: dir }] }) },
        {},
        {},
        { findAll: async () => [] },
        {
            analyze: async () => {
                analyzed++;

                return null;
            },
        },
        {},
    );

    const result = await model.scanImportDirectory({ importDirName: 'import', analyze: false });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].fileName, 'sample.ts');
    assert.equal(result.items[0].size, 5);
    // 番組情報の推定は行わない
    assert.equal(result.items[0].estimatedName, undefined);
    assert.equal(analyzed, 0);
});

test('addUploadedVideoFile passes through an uploaded file without path validation', async () => {
    const calls = [];
    const model = makeModel([], calls);
    await model.addUploadedVideoFile({
        parentDirectoryName: 'recorded',
        viewName: 'sample.ts',
        fileType: 'ts',
        filePath: '/tmp/upload/xxxx',
        fileName: 'sample.ts',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].filePath, '/tmp/upload/xxxx');
});

// multipart/form-data では未入力の項目が空文字で届くことがある。
// 空文字を「サーバー上のファイル指定」と誤認すると、importDirs 未設定の環境で
// ブラウザからの通常の TS アップロードまで ImportDirsNotConfigured で失敗してしまう
test('addUploadedVideoFile treats an empty localFilePath as unset', async () => {
    const calls = [];
    const model = makeModel(undefined, calls);
    await model.addUploadedVideoFile({
        parentDirectoryName: 'recorded',
        viewName: 'sample.ts',
        fileType: 'ts',
        filePath: '/tmp/upload/xxxx',
        fileName: 'sample.ts',
        localFilePath: '',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].filePath, '/tmp/upload/xxxx');
});

// importDirs ごと未設定なのか、名前が違うだけなのかを切り分けられるようにする
// (EDCB 録画の取り込みが動かない原因の大半は config.yml の importDirs 未設定)
test('scanImportDirectory reports ImportDirsNotConfigured when importDirs is empty', async () => {
    const model = new Model({}, {}, {}, {}, { getConfig: () => ({}) }, {}, {}, {}, {}, {});
    await assert.rejects(
        () => model.scanImportDirectory({ importDirName: 'import' }),
        /ImportDirsNotConfigured/,
    );
});
