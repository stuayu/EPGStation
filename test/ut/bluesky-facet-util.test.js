'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildBlueskyFacets } = require('../../dist/model/sns/BlueskyFacetUtil');

const byteLen = s => Buffer.byteLength(s, 'utf8');

test('URL facet は日本語混在時も UTF-8 バイトオフセットで計算される', () => {
    const text = 'テスト https://example.com/a';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 1);
    const [facet] = facets;
    assert.equal(facet.features[0].$type, 'app.bsky.richtext.facet#link');
    assert.equal(facet.features[0].uri, 'https://example.com/a');
    assert.equal(facet.index.byteStart, byteLen('テスト '));
    assert.equal(facet.index.byteEnd, byteLen('テスト ') + byteLen('https://example.com/a'));
});

test('ハッシュタグ facet の tag 値には先頭の # が含まれない', () => {
    const text = '実況 #番組名';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 1);
    assert.equal(facets[0].features[0].$type, 'app.bsky.richtext.facet#tag');
    assert.equal(facets[0].features[0].tag, '番組名');
    assert.equal(facets[0].index.byteStart, byteLen('実況 '));
    assert.equal(facets[0].index.byteEnd, byteLen('実況 ') + byteLen('#番組名'));
});

test('全角＃のハッシュタグも認識される', () => {
    const text = '＃全角タグ です';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 1);
    assert.equal(facets[0].features[0].tag, '全角タグ');
});

test('URL 末尾の句読点・閉じ括弧は facet から除外される', () => {
    // トークナイザは空白区切りで URL を拾うため、閉じ括弧の直後に空白が無いと
    // 後続の文章まで URL に取り込まれてしまう (KonomiTV 移植元と同じ挙動)。
    // そのため末尾記号の直後に空白がある実用的なケースで検証する
    const text = 'サイト (https://example.com) を見て';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 1);
    // 末尾の ) は facet の URI に含まれない
    assert.equal(facets[0].features[0].uri, 'https://example.com');
});

test('ハッシュタグ末尾の句読点も facet から除外される', () => {
    const text = 'これ #番組名、 見て';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 1);
    assert.equal(facets[0].features[0].tag, '番組名');
    // facet の範囲は '、' を含まない (#番組名 の 4 文字ぶんの byte 長)
    assert.equal(facets[0].index.byteEnd - facets[0].index.byteStart, byteLen('#番組名'));
});

test('絵文字混在時も UTF-8 バイトオフセットで正しく計算される (サロゲートペア考慮)', () => {
    const text = '🎉 #tag';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 1);
    // 🎉 (U+1F389) は UTF-8 で 4 byte、続く半角スペースで 1 byte
    assert.equal(facets[0].index.byteStart, 5);
    assert.equal(facets[0].features[0].tag, 'tag');
});

test('記号だけになるハッシュタグは facet を作らない', () => {
    // 末尾の句読点を取り除くと空文字列になるトークン (# のみ) は無視される
    const text = 'これ #、 です';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 0);
});

test('1 つの本文に URL とタグが混在しても両方 facet 化される', () => {
    const text = '見てね https://example.com/a #番組';
    const facets = buildBlueskyFacets(text);
    assert.equal(facets.length, 2);
    assert.equal(facets[0].features[0].$type, 'app.bsky.richtext.facet#link');
    assert.equal(facets[1].features[0].$type, 'app.bsky.richtext.facet#tag');
    assert.equal(facets[1].features[0].tag, '番組');
});
