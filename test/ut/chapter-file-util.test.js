'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const ChapterFileUtil = require('../../dist/util/ChapterFileUtil').default;

// MPEG-TS はチャプターを埋め込めないため、Amatsukaze の tsreplace 出力 (.ts のまま) では
// チャプターが `<動画ファイル名>.chapter.txt` に書き出される。その解析を検証する。

// 実際の Amatsukaze 出力 (CM 判定のラベル付き)
const REAL_CONTENT = [
    'CHAPTER01=00:00:00.000',
    'CHAPTER01NAME=CM?',
    'CHAPTER02=00:00:20.754',
    'CHAPTER02NAME=A',
    'CHAPTER03=00:12:28.815',
    'CHAPTER03NAME=CM',
    '',
].join('\r\n');

test('CHAPTERxx / CHAPTERxxNAME の組を解析する', () => {
    const chapters = ChapterFileUtil.parse(REAL_CONTENT);

    assert.equal(chapters.length, 3);
    assert.deepEqual(
        chapters.map(c => c.startAt),
        [0, 20.754, 748.815],
    );
    assert.deepEqual(
        chapters.map(c => c.title),
        ['CM?', 'A', 'CM'],
    );
});

test('endAt は次のチャプターの開始位置で埋める', () => {
    const chapters = ChapterFileUtil.parse(REAL_CONTENT);

    assert.equal(chapters[0].endAt, chapters[1].startAt);
    assert.equal(chapters[1].endAt, chapters[2].startAt);
});

test('最後のチャプターの endAt には動画全体の長さを使う', () => {
    const chapters = ChapterFileUtil.parse(REAL_CONTENT, 1500.5);

    assert.equal(chapters[2].endAt, 1500.5);
});

test('動画の長さが不明なら最後の endAt は開始位置と同じになる', () => {
    const chapters = ChapterFileUtil.parse(REAL_CONTENT);

    assert.equal(chapters[2].endAt, chapters[2].startAt);
});

test('開始位置の昇順に並べ替え、id を振り直す', () => {
    const chapters = ChapterFileUtil.parse(
        ['CHAPTER02=00:01:00.000', 'CHAPTER02NAME=後', 'CHAPTER01=00:00:00.000', 'CHAPTER01NAME=前'].join('\n'),
    );

    assert.deepEqual(
        chapters.map(c => [c.id, c.startAt, c.title]),
        [
            [0, 0, '前'],
            [1, 60, '後'],
        ],
    );
});

test('NAME 行が無いチャプターは title が null になる', () => {
    const chapters = ChapterFileUtil.parse('CHAPTER01=00:00:10.500');

    assert.deepEqual(chapters, [{ id: 0, startAt: 10.5, endAt: 10.5, title: null }]);
});

test('開始位置を読めない項目 (NAME 行だけ) は捨てる', () => {
    const chapters = ChapterFileUtil.parse(['CHAPTER01NAME=名前だけ', 'CHAPTER02=00:00:05.000'].join('\n'));

    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].startAt, 5);
});

test('時刻の時・ミリ秒は省略できる', () => {
    const chapters = ChapterFileUtil.parse(['CHAPTER01=00:00', 'CHAPTER02=1:02:03.5'].join('\n'));

    assert.deepEqual(
        chapters.map(c => c.startAt),
        [0, 3723.5],
    );
});

test('BOM 付き・関係ない行が混ざっていても読める', () => {
    const chapters = ChapterFileUtil.parse(['﻿CHAPTER01=00:00:00.000', '# コメント', '', 'ゴミ行'].join('\n'));

    assert.equal(chapters.length, 1);
});

test('チャプターが 1 件も無ければ空配列', () => {
    assert.deepEqual(ChapterFileUtil.parse(''), []);
    assert.deepEqual(ChapterFileUtil.parse('関係のない内容'), []);
});

test('チャプターファイルのパスは最後の拡張子だけを差し替える', () => {
    assert.equal(
        ChapterFileUtil.getChapterFilePath(path.join('D:', 'encode', 'foo.hevc.ts')),
        path.join('D:', 'encode', 'foo.hevc.chapter.txt'),
    );
    assert.equal(
        ChapterFileUtil.getChapterFilePath(path.join('D:', 'encode', 'bar.mkv')),
        path.join('D:', 'encode', 'bar.chapter.txt'),
    );
});
