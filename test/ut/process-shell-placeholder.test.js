'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const ProcessUtil = require('../../dist/util/ProcessUtil').default;

// シェル経由 (cmd に | を含むパイプライン) で実行するコマンドへ
// 録画ファイルのパスを埋め込むときの引用符付けを検証する。
// 引用符が無いと、空白や括弧を含むファイル名でコマンドが途中で切れ、
// 録画ファイルのストリーミングがプロセス生成の時点で失敗する。

const isWin = process.platform === 'win32';
// 実際に配信に失敗したファイル名 (空白・括弧・全角記号を含む)
const REAL_PATH = isWin
    ? 'F:\\EPGStation\\encode\\202608151635_アニメ 魔入りました!入間くん4(18)若葉には大いなる糧を／こもれびまたいで_NHKEテレ1福島.hevc.ts'
    : '/mnt/encode/202608151635_アニメ 魔入りました!入間くん4(18)若葉には大いなる糧を／こもれびまたいで_NHKEテレ1福島.hevc.ts';

const CMD = 'QSVEncC --avhw --seek 0 -i %INPUT% -o - | ffmpeg -i pipe:0 -f hls %OUTPUT%';

test('空白・括弧を含むパスは引用符で囲まれる', () => {
    const cmd = ProcessUtil.replaceShellPlaceholder(CMD, '%INPUT%', REAL_PATH);
    const quote = isWin ? '"' : "'";

    assert.ok(cmd.includes(`-i ${quote}${REAL_PATH}${quote} -o -`), cmd);
});

test('引用符付きの値はシェルで 1 つの引数として解釈される', () => {
    const quoted = ProcessUtil.quoteShellArg(REAL_PATH);

    // 引用符を外すと元の値に戻る (エスケープの過不足が無いこと)
    if (isWin) {
        assert.equal(quoted, `"${REAL_PATH}"`);
    } else {
        assert.equal(quoted, `'${REAL_PATH}'`);
    }
});

test('config.yml 側で既に引用符が書かれている場合は二重に囲わない', () => {
    const cmd = ProcessUtil.replaceShellPlaceholder('ffmpeg -i "%INPUT%" out.mp4 | cat', '%INPUT%', 'a b.ts');

    assert.equal(cmd, 'ffmpeg -i "a b.ts" out.mp4 | cat');
});

test('プレースホルダが複数あればすべて置換する', () => {
    const cmd = ProcessUtil.replaceShellPlaceholder('a %INPUT% b %INPUT% c', '%INPUT%', 'x y');
    const quote = isWin ? '"' : "'";

    assert.equal(cmd, `a ${quote}x y${quote} b ${quote}x y${quote} c`);
});

test('プレースホルダが無ければコマンドはそのまま', () => {
    assert.equal(ProcessUtil.replaceShellPlaceholder('ffmpeg -i pipe:0 | cat', '%INPUT%', 'x'), 'ffmpeg -i pipe:0 | cat');
});

if (isWin === false) {
    test("sh ではシングルクォート自身も安全にエスケープする", () => {
        assert.equal(ProcessUtil.quoteShellArg("it's.ts"), `'it'\\''s.ts'`);
    });

    test('sh では $ やバッククォートが展開されない形で囲む', () => {
        const cmd = ProcessUtil.replaceShellPlaceholder(CMD, '%INPUT%', '/rec/$HOME`id`.ts');

        assert.ok(cmd.includes(`-i '/rec/$HOME\`id\`.ts' -o -`), cmd);
    });
}
