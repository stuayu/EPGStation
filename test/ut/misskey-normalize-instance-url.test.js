'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const MisskeyClient = require('../../dist/model/sns/MisskeyClient').default;

// normalizeInstanceUrl() は http クライアントを使わないため、スタブは空実装で足りる
const client = new MisskeyClient({});

test('スキーム付き URL をホスト名のみへ正規化する', () => {
    assert.equal(client.normalizeInstanceUrl('https://misskey.io/'), 'misskey.io');
    assert.equal(client.normalizeInstanceUrl('http://misskey.io'), 'misskey.io');
});

test('ホスト名のみの入力はそのまま (小文字化のみ) 通す', () => {
    assert.equal(client.normalizeInstanceUrl('Misskey.IO'), 'misskey.io');
});

test('パス・クエリ・フラグメントを除去する', () => {
    assert.equal(client.normalizeInstanceUrl('https://misskey.io/@user?ref=x#frag'), 'misskey.io');
});

test('前後の空白を取り除く', () => {
    assert.equal(client.normalizeInstanceUrl('  misskey.io  '), 'misskey.io');
});

test('サブドメイン付きホストも保持する', () => {
    assert.equal(client.normalizeInstanceUrl('https://misskey.example.co.jp/'), 'misskey.example.co.jp');
});
