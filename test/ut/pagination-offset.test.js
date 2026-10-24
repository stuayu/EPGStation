'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSafePageQuery, resolveSafePageOffset } = require('../../dist/util/PaginationOffset');

test('現在ページの最後の項目を削除したら残存する最後のページへ戻す', () => {
    assert.equal(resolveSafePageOffset(20, 10, 20), 10);
});

test('すべての項目が無くなったら先頭ページへ戻す', () => {
    assert.equal(resolveSafePageOffset(20, 10, 0), 0);
});

test('範囲内のページは維持する', () => {
    assert.equal(resolveSafePageOffset(10, 10, 15), 10);
});

test('Series の URL query は安全なページへ置き換え、先頭ページでは page を除く', () => {
    assert.deepEqual(buildSafePageQuery({ page: '3', keyword: '作品' }, 30, 30), { page: '2', keyword: '作品' });
    assert.deepEqual(buildSafePageQuery({ page: '99', keyword: '作品' }, 0, 30), { keyword: '作品' });
});
