'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createJikkyoPostPayload,
    validateJikkyoPost,
    createJikkyoThreadKey,
    shouldDropJikkyoEcho,
} = require('../../dist/util/JikkyoPostUtil');

test('投稿本文の空・長さ・改行・連投を検証する', () => {
    assert.match(validateJikkyoPost('   ', 2000, null), /入力/);
    assert.match(validateJikkyoPost('あ'.repeat(76), 2000, null), /75/);
    assert.match(validateJikkyoPost('改行\nあり', 2000, null), /改行/);
    assert.match(validateJikkyoPost('投稿', 1999, 1000), /連続/);
    assert.equal(validateJikkyoPost('あ'.repeat(75), 2000, 1000), null);
});

test('投稿 payload は色・位置・サイズと 10 ミリ秒単位 vpos を変換する', () => {
    assert.deepEqual(
        createJikkyoPostPayload(
            { text: 'テスト', color: '#f02840', type: 'top', size: 'big' },
            1780000012345,
            1780000000000,
        ),
        {
            type: 'postComment',
            data: { text: 'テスト', color: 'red', position: 'ue', size: 'big', vpos: 1235, isAnonymous: true },
        },
    );
    assert.equal(
        createJikkyoPostPayload({ text: 'x', color: '#FFEAEA', type: 'right', size: 'small' }, 10, 0).data.position,
        'naka',
    );
    assert.equal(
        createJikkyoPostPayload({ text: 'x', color: '#FDA708', type: 'bottom', size: 'medium' }, 10, 0).data.position,
        'shita',
    );
});

test('未対応色は送信 payload に変換しない', () => {
    assert.throws(
        () => createJikkyoPostPayload({ text: 'x', color: '#000000', type: 'right', size: 'medium' }, 10, 0),
        /Unsupported/,
    );
});

test('hashedUserId から threadkey を作り、欠損時は null', () => {
    assert.equal(createJikkyoThreadKey('abc123'), 'nicolive:abc123');
    assert.equal(createJikkyoThreadKey(undefined), null);
});

test('yourpost と送信直後の同一本文エコーを一度だけ除外', () => {
    const pending = [{ text: '投稿', sentAt: 1000 }];
    assert.equal(shouldDropJikkyoEcho({ yourpost: 1 }, true, pending, 2000), true);
    assert.equal(shouldDropJikkyoEcho({ content: '投稿' }, true, pending, 2000), true);
    assert.equal(shouldDropJikkyoEcho({ content: '投稿' }, true, pending, 2000), false);
    assert.equal(shouldDropJikkyoEcho({ content: '遅い' }, true, [{ text: '遅い', sentAt: 0 }], 6000), false);
});
