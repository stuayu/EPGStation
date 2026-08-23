'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const runner = path.join(__dirname, '..', 'support', 'thumbnail-manage-model-runner.js');

function runScenario(name) {
    const env = { ...process.env };
    delete env.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, [runner, name], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('既存DB行と画像を削除してから指定した動画ファイルを生成キューへ追加する', () => {
    runScenario('replaceRecorded');
});

test('別録画の動画ファイルはサムネイルを削除する前に拒否する', () => {
    runScenario('rejectForeignVideoFile');
});

test('サムネイル削除はDB行と画像を削除してイベントを通知する', () => {
    runScenario('deleteThumbnail');
});

test('公開再生成経路は従来どおり先頭動画とprofileを使う', () => {
    runScenario('regenerateRecorded');
});

test('サムネイルのファイル名衝突回避とposter寸法を解決する', () => {
    runScenario('filenameAndSizeHelpers');
});
