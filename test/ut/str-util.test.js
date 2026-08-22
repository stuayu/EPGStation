'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const StrUtil = require('../../dist/util/StrUtil').default;

test('toDBStr() は NUL 文字 (PostgreSQL 非対応) を取り除く', () => {
    assert.equal(StrUtil.toDBStr('a\x00b\x00c'), 'abc');
    assert.equal(StrUtil.toDBStr('no null'), 'no null');
});

test('toHalf() は全角英数記号を半角へ変換する', () => {
    assert.equal(StrUtil.toHalf('ＡＢＣ１２３'), 'ABC123');
});

test('toHalf() は全角の引用符・円記号・スペース・波ダッシュも個別に変換する', () => {
    assert.equal(StrUtil.toHalf('”hello’‘￥　〜'), '"hello\'`\\ ~');
});

test('toDouble() は半角英数記号を全角へ変換する (toHalf の逆)', () => {
    assert.equal(StrUtil.toDouble('ABC123'), 'ＡＢＣ１２３');
});

test('toDouble() は \\ を先に全角円記号へ変換してから !-~ の範囲を全角化する', () => {
    // \\ -> ￥ が最初に走るため、想定より前で変換される (実装どおりの挙動を固定する)
    assert.equal(StrUtil.toDouble('a\\b'), 'ａ￥ｂ');
});

test('toDouble() は !-~ 変換後に “ ‘ ` スペース ~ を重ねて全角化する', () => {
    assert.equal(StrUtil.toDouble(`"a" 'b' \`c\` d~e`), '＂ａ＂　＇ｂ＇　｀ｃ｀　ｄ～ｅ');
});

test('deleteBrackets() は [] でくくられた文字列と囲み文字を削除し前後の空白を trim する', () => {
    assert.equal(StrUtil.deleteBrackets('  [字][双]番組名[新]  '), '番組名');
});

test('deleteBrackets() は囲み文字 (丸囲み絵文字) を削除する', () => {
    // U+1F210 ([手]相当の囲み文字)
    assert.equal(StrUtil.deleteBrackets('番組\u{1f210}名'), '番組名');
});

test('replaceEnclosedCharacters() は囲み文字を [] 表記へ置き換える (deleteBrackets の逆方向)', () => {
    assert.equal(StrUtil.replaceEnclosedCharacters('番組\u{1f210}\u{1f211}名'), '番組[手][字]名');
});

test('replaceDirName() は Windows のディレクトリ名で禁止された文字を全角へ置換する', () => {
    assert.equal(StrUtil.replaceDirName('a:b*c?d"e<f>g|h.i'), 'a：b＊c？d”e＜f＞g｜h．i');
});

test('replaceFileName() は replaceDirName に加えて / \\ ¥ も置換する', () => {
    assert.equal(StrUtil.replaceFileName('a/b\\c¥d'), 'a／b￥c￥d');
});
