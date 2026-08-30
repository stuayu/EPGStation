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
        '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn  -c:a aac -f mp4 pipe:1',
    );
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
    assert.match(sub, /-af pan=stereo\|c0=c1\|c1=c1,volume=2/);
    assert.equal((sub.match(/(?:^| )-af\b/g) ?? []).length, 1);
});

test('ブースト無しの主音声・副音声はフィルタ無しまたは pan のみ', () => {
    assert.doesNotMatch(AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'main', 1, 'ts'), /-af/);
    assert.match(AudioTrackUtil.replacePlaceholders(FILTER_CMD, 'sub', 1, 'encoded'), /-af pan=stereo\|c0=c1\|c1=c1/);
});

test('数字指定は音声 ES を -map で選ぶ (映像も明示する必要がある)', () => {
    const cmd = AudioTrackUtil.replacePlaceholders(CMD, '2');
    assert.match(cmd, /-map 0:v:0 -map 0:a:2/);
    // ES 指定時のデュアルモノラルは主音声側を使う
    assert.match(cmd, /-dual_mono_mode main/);
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
