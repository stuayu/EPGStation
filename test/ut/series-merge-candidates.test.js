'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { commonPrefixLength, rankMergeCandidates } = require('../../dist/model/series/SeriesMergeCandidates');
const { getSeriesOrigin } = require('../../dist/model/series/SeriesOrigin');

test('common prefix length counts the shared head only', () => {
    assert.equal(commonPrefixLength('よふかしのうた', 'よふかしのうた2期'), 7);
    assert.equal(commonPrefixLength('よふかしのうた', 'よるのばけもの'), 1);
    assert.equal(commonPrefixLength('', 'なにか'), 0);
});

test('merge candidates classify the direction of the prefix match', () => {
    const target = { id: 1, normalizedTitle: 'よふかしのうた' };
    const result = rankMergeCandidates(target, [
        // 対象より長い = 誤って副題付きで作られた側
        { id: 2, normalizedTitle: 'よふかしのうた2期' },
        // 対象と完全一致
        { id: 3, normalizedTitle: 'よふかしのうた' },
        // 対象のほうが長い
        { id: 4, normalizedTitle: 'よふかし' },
        // 先頭の一部だけ一致
        { id: 5, normalizedTitle: 'よふ神さま' },
    ]);
    assert.deepEqual(
        result.map(x => [x.item.id, x.matchType]),
        [
            [3, 'exact'],
            [2, 'prefix'],
            [4, 'contained'],
            [5, 'partial'],
        ],
    );
});

test('merge candidates drop the target itself and near-unrelated titles', () => {
    const target = { id: 1, normalizedTitle: 'よふかしのうた' };
    const result = rankMergeCandidates(target, [
        { id: 1, normalizedTitle: 'よふかしのうた' },
        // 先頭 1 文字しか共通しないものは候補にしない
        { id: 2, normalizedTitle: 'よるのばけもの' },
    ]);
    assert.deepEqual(result, []);
});

test('merge candidates keep the longest common prefix first within the same match type', () => {
    const target = { id: 1, normalizedTitle: 'アニメタイトル' };
    const result = rankMergeCandidates(target, [
        { id: 2, normalizedTitle: 'アニメたいとる' },
        { id: 3, normalizedTitle: 'アニメタイトr' },
    ]);
    assert.deepEqual(
        result.map(x => x.item.id),
        [3, 2],
    );
});

test('merge candidates respect the limit', () => {
    const target = { id: 1, normalizedTitle: 'ばんぐみ' };
    const candidates = [2, 3, 4].map(id => ({ id, normalizedTitle: `ばんぐみ${id}` }));
    assert.equal(rankMergeCandidates(target, candidates, { limit: 2 }).length, 2);
});

test('series origin is dictionary when any external work id is present', () => {
    assert.equal(getSeriesOrigin({ syobocalTid: 1234, annictId: null, wikidataQid: null }), 'dictionary');
    assert.equal(getSeriesOrigin({ syobocalTid: null, annictId: 'A1', wikidataQid: null }), 'dictionary');
    assert.equal(getSeriesOrigin({ syobocalTid: null, annictId: null, wikidataQid: 'Q1' }), 'dictionary');
    assert.equal(getSeriesOrigin({ syobocalTid: null, annictId: null, wikidataQid: null }), 'local');
    // 空文字は「無い」と同じ扱いにする (辞書同期の失敗で空文字が入ることがあるため)
    assert.equal(getSeriesOrigin({ syobocalTid: null, annictId: '', wikidataQid: '' }), 'local');
});
