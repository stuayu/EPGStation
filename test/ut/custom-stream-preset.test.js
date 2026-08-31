'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { cloneBuiltinPreset, toStreamProfile } = require('../../dist/util/CustomStreamPresetUtil');
const builtins = require('../../dist/util/BuiltinStreamPresets').BUILTIN_STREAM_PRESETS;

test('Built-in を複製すると同じ基本設定を持つカスタム入力になる', () => {
    const source = builtins.find(x => x.id === '1080p');
    const copy = cloneBuiltinPreset(source, 'custom-test');
    assert.equal(copy.id, 'custom-test');
    assert.equal(copy.name, source.name);
    assert.deepEqual(copy.output, source.output);
});

test('カスタムプリセットを保存して読み出せる形へ変換できる', () => {
    const input = { id: 'custom-save', name: '保存テスト', useFor: 'both', container: 'hls', output: { codec: 'h264', resolution: '720p', bitDepth: 8 }, customOptions: { rateControl: 'VBR', gop: 60 } };
    const profile = toStreamProfile(input);
    const read = JSON.parse(JSON.stringify(profile));
    assert.equal(read.id, input.id);
    assert.equal(read.customOptions.rateControl, 'VBR');
});

test('Raw Command 指定時は自動生成用の設定より優先される', () => {
    const profile = toStreamProfile({ id: 'custom-raw', name: 'Raw', useFor: 'live', container: 'hls', output: { codec: 'h264', resolution: '1080p' }, rawCommand: '%FFMPEG% -i pipe:0 -c:v libx264 custom' });
    assert.equal(profile.cmd, '%FFMPEG% -i pipe:0 -c:v libx264 custom');
    assert.notEqual(profile.cmd, undefined);
});
