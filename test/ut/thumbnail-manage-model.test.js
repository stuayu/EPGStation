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

test('公開再生成経路は最新IDのencoded動画を優先する', () => {
    runScenario('regenerateRecordedPrefersLatestEncoded');
});

test('チャプターはencoded動画だけ読み、生TSでは読まない', () => {
    runScenario('chaptersOnlyForEncoded');
});

test('encoded動画のチャプター読取失敗時も元候補で継続する', () => {
    runScenario('chapterFailureContinues');
});

test('サムネイルのファイル名衝突回避とposter寸法を解決する', () => {
    runScenario('filenameAndSizeHelpers');
});

test('同じ動画の待機中・実行中の重複追加は1件にまとめ、完了後は再追加できる', () => {
    runScenario('duplicateQueue');
});

test('サムネイル生成失敗後も同じ動画を再追加できる', () => {
    runScenario('failedQueueCanRetry');
});

test('後処理のresize失敗でキューを停止させず後続ジョブを実行する', () => {
    runScenario('createFailureThenQueueProgresses');
});

test('meta保存失敗時にcreateをrejectし新規DB行と画像をロールバックする', () => {
    runScenario('metaFailureRejectsAndRollsBack');
});

test('ロールバックしても復元した旧世代の画像ファイルは残す', () => {
    runScenario('rollbackKeepsRestoredThumbnailFile');
});
