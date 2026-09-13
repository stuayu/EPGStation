'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const AudioTrackUtil = require('../../dist/model/service/stream/util/AudioTrackUtil').default;

// 配信コマンドの音声トラック指定・音声フィルタの展開を検証する。

const CMD = '%FFMPEG% %DUALMONOMODE% -i pipe:0 -sn %AUDIOMAP% -c:a aac -f mp4 pipe:1';
const FILTER_CMD = '%FFMPEG% %DUALMONOMODE% -i pipe:0 -sn %AUDIOMAP% -c:a aac %AUDIOFILTER% -f mp4 pipe:1';

test('音声フィルタはブースト倍率へ置換され、1.0 では空になる', () => {
    assert.match(AudioTrackUtil.replacePlaceholders(FILTER_CMD, undefined, 2), /-af volume=2/);
    assert.doesNotMatch(AudioTrackUtil.replacePlaceholders(FILTER_CMD, undefined, 1), /AUDIOFILTER|volume=/);
    assert.doesNotMatch(AudioTrackUtil.replacePlaceholders(FILTER_CMD, undefined, 5), /AUDIOFILTER/);
});

test('未指定なら主音声 (dual_mono_mode main) で -map を付けない', () => {
    assert.equal(
        AudioTrackUtil.replacePlaceholders(CMD, undefined),
        '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -c:a aac -f mp4 pipe:1',
    );
});

test('空の音声プレースホルダは余分な空白を残さない', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(
        '%FFMPEG% %DUALMONOMODE% -i pipe:0 -sn  %AUDIOMAP%  -c:a aac %AUDIOFILTER% -f mp4 pipe:1',
        'main',
        1,
        'encoded',
    );

    assert.equal(cmd, '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -c:a aac -f mp4 pipe:1');
});

test("'main' は未指定と同じ扱いになる", () => {
    assert.equal(AudioTrackUtil.replacePlaceholders(CMD, 'main'), AudioTrackUtil.replacePlaceholders(CMD, undefined));
});

test("'sub' はデュアルモノラルの副音声を選ぶ (-map ではなく dual_mono_mode で切り替える)", () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, 'sub');
    assert.match(cmd, /-dual_mono_mode sub/);
    assert.doesNotMatch(cmd, /-map/);
});

test('TS の主音声・副音声とブーストを 1 本の -af へまとめる', () => {
    const main = AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'main', 2, 'ts');
    const sub = AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'sub', 2, 'ts');
    assert.match(main, /-dual_mono_mode main/);
    assert.match(sub, /-dual_mono_mode sub/);
    assert.match(main, /-af volume=2/);
    assert.match(sub, /-af volume=2/);
    assert.equal((sub.match(/(?:^| )-af\b/g) ?? []).length, 1);
    assert.doesNotMatch(sub, /AUDIOFILTER|AUDIOBOOST/);
});

test('encoded の副音声だけ pan を追加し、主音声はステレオを維持する', () => {
    const main = AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'main', 2, 'encoded');
    const sub = AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'sub', 2, 'encoded');
    assert.doesNotMatch(main, /pan=/);
    assert.match(sub, /-dual_mono_mode main/);
    assert.match(sub, /-af "pan=stereo\|c0=c1\|c1=c1,volume=2"/);
    assert.equal((sub.match(/(?:^| )-af\b/g) ?? []).length, 1);
});

test('ブースト無しの主音声・副音声はフィルタ無しまたは pan のみ', () => {
    assert.doesNotMatch(AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'main', 1, 'ts'), /-af/);
    assert.match(AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'sub', 1, 'encoded'), /-af "pan=stereo\|c0=c1\|c1=c1"/);
});

test('数字指定は音声 ES を optional map で選び、欠落時は主音声へ落とす', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, '2');
    assert.match(cmd, /-map 0:v:0 -map "0:a:2\?" -map "0:a:0\?"/);
    // ES 指定時のデュアルモノラルは主音声側を使う
    assert.match(cmd, /-dual_mono_mode main/);
});

test('独立した 2 本目の音声 ES は channels 情報に関係なく -map 0:a:1 で選ぶ', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, '1', undefined, 'ts', false);
    assert.match(cmd, /-map 0:v:0 -map "0:a:1\?" -map "0:a:0\?"/);
    assert.match(cmd, /-dual_mono_mode main/);
    assert.doesNotMatch(cmd, /-dual_mono_mode sub/);
});

test('不正な値は主音声へ落とす (ffmpeg の既定の音声選択に任せる)', () => {
    for (const value of ['bogus', '-1', '']) {
        const cmd = AudioTrackUtil.replacePlaceholders(CMD, value);
        assert.match(cmd, /-dual_mono_mode main/);
        assert.doesNotMatch(cmd, /-map/);
    }
});

test('プレースホルダを含まない手書き cmd は書き換えられない', () => {
    const handwritten = '%FFMPEG% -dual_mono_mode main -i pipe:0 -c:a aac -f mp4 pipe:1';
    assert.equal(AudioTrackUtil.replacePlaceholders(handwritten, 'sub'), handwritten);
});

test('parseStreamIndex は音声 ES のインデックスのみを返す', () => {
    assert.equal(AudioTrackUtil.parseStreamIndex(undefined), null);
    assert.equal(AudioTrackUtil.parseStreamIndex('main'), null);
    assert.equal(AudioTrackUtil.parseStreamIndex('sub'), null);
    assert.equal(AudioTrackUtil.parseStreamIndex('0'), 0);
    assert.equal(AudioTrackUtil.parseStreamIndex('3'), 3);
    assert.equal(AudioTrackUtil.parseStreamIndex('-1'), null);
    assert.equal(AudioTrackUtil.parseStreamIndex('x'), null);
});

// ---- tsreadex で正規化した TS ----
// tsreadex (-a 13) はデュアルモノラルを主音声・副音声の 2 本の音声 ES へ分離するため、
// 副音声は -dual_mono_mode sub ではなく -map 0:a:1 で選ぶ必要がある

test('tsreadex 正規化済みの副音声は 2 本目の音声 ES として選ぶ', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, 'sub', 1, 'ts', true);
    assert.match(cmd, /-map 0:v:0 -map "0:a:1\?" -map "0:a:0\?"/);
    // 分離済みなので dual_mono_mode では切り替わらない
    assert.match(cmd, /-dual_mono_mode main/);
});

test('tsreadex 正規化済みの主音声は 1 本目の音声 ES として選ぶ', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, 'main', 1, 'ts', true);
    assert.match(cmd, /-map 0:v:0 -map "0:a:0\?"/);
    assert.match(cmd, /-dual_mono_mode main/);
});

test('tsreadex 正規化済みなら encoded の副音声へ pan を掛けない', () => {
    assert.doesNotMatch(AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'sub', 1, 'encoded', true), /pan=/);
    assert.match(AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'sub', 1, 'encoded', false), /pan=stereo/);
});

test('音声 ES のインデックス指定は tsreadex の有無で変わらない', () => {
    for (const normalized of [false, true]) {
        assert.match(
            AudioTrackUtil.replacePlaceholders(CMD, '2', 1, 'ts', normalized),
            /-map 0:v:0 -map "0:a:2\?" -map "0:a:0\?"/,
        );
    }
});

// ---- audioTrack: 'all' (主音声・副音声の同時配信) ----

test("tsreadex 正規化済みの 'all' は主音声・副音声の両方の ES を map する", () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, 'all', undefined, 'ts', true);
    assert.match(cmd, /-map 0:v:0 -map "0:a:0\?" -map "0:a:1\?"/);
});

test("tsreadex 無しの 'all' はデュアルモノラルの 1 ES しか無いため 'main' と同じ扱いになる", () => {
    const all = AudioTrackUtil.replacePlaceholders(CMD, 'all', undefined, 'ts', false);
    const main = AudioTrackUtil.replacePlaceholders(CMD, 'main', undefined, 'ts', false);
    assert.equal(all, main);
    assert.doesNotMatch(all, /-map 0:a:0 -map 0:a:1/);
});

test('tsreadex 正規化済みで audioTrack 未指定なら index 0 (主音声 ES) を明示的に選ぶ', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, undefined, undefined, 'ts', true);
    assert.match(cmd, /-map 0:v:0 -map "0:a:0\?"/);
});

test('m2tsll 用の音声専用 map は映像 map と分離して選択する', () => {
    assert.equal(AudioTrackUtil.replacePlaceholders('%AUDIOSELECTMAP%', undefined, undefined, 'encoded'), '-map "0:a:0?"');
    assert.equal(
        AudioTrackUtil.replacePlaceholders('%AUDIOSELECTMAP%', '2', undefined, 'encoded'),
        '-map "0:a:2?" -map "0:a:0?"',
    );
    assert.equal(
        AudioTrackUtil.replacePlaceholders('%AUDIOSELECTMAP%', 'all', undefined, 'ts', true),
        '-map "0:a:0?" -map "0:a:1?"',
    );
});

test('tsreadex 無しで audioTrack 未指定なら従来どおり -map を付けない', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, undefined, undefined, 'ts', false);
    assert.doesNotMatch(cmd, /-map/);
});
