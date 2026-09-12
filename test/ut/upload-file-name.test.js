'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const UploadFileNameUtil = require('../../dist/util/UploadFileNameUtil').default;

test('アップロード元の日本語ファイル名を UTF-8 のまま正規化する', () => {
    assert.equal(UploadFileNameUtil.normalize('番組 第1話.mp4'), '番組 第1話.mp4');
    assert.equal(UploadFileNameUtil.normalize('C:\\録画\\番組.mp4'), '番組.mp4');
    assert.equal(UploadFileNameUtil.normalize('/tmp/番組.mp4'), '番組.mp4');
});

test('Windows で使えない名前と予約名を正規化する', () => {
    assert.equal(UploadFileNameUtil.normalize('a<b>:c?.mp4'), 'a_b__c_.mp4');
    assert.equal(UploadFileNameUtil.normalize('CON.ts'), '_CON.ts');
    assert.equal(UploadFileNameUtil.normalize('...'), 'uploaded');
});

test('長いファイル名を UTF-8 バイト数で切り詰める', () => {
    const name = UploadFileNameUtil.normalize(`${'あ'.repeat(200)}.mp4`);
    assert.ok(Buffer.byteLength(name, 'utf8') <= 240);
    assert.equal(name.endsWith('.mp4'), true);
});
