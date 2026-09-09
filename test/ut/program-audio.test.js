'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const ProgramAudioUtil = require('../../dist/util/ProgramAudioUtil').default;
const ProgramAudioTrackUtil = require('../../dist/util/ProgramAudioTrackUtil').default;

// ---- ProgramAudioUtil.parse ----

test('DB の JSON 文字列を音声 ES 一覧へ変換する', () => {
    const json = JSON.stringify([
        { componentType: 2, componentTag: 16, isMain: true, samplingRate: 48000, langs: ['jpn', 'eng'] },
    ]);

    assert.deepEqual(ProgramAudioUtil.parse(json), [
        { componentType: 2, isMain: true, componentTag: 16, samplingRate: 48000, langs: ['jpn', 'eng'] },
    ]);
});

test('未設定・空文字・壊れた JSON は null を返す', () => {
    assert.equal(ProgramAudioUtil.parse(null), null);
    assert.equal(ProgramAudioUtil.parse(undefined), null);
    assert.equal(ProgramAudioUtil.parse(''), null);
    assert.equal(ProgramAudioUtil.parse('{'), null);
});

test('配列でない JSON と componentType を欠く要素は捨てる', () => {
    assert.equal(ProgramAudioUtil.parse('{"componentType":3}'), null);
    assert.equal(ProgramAudioUtil.parse(JSON.stringify([{ isMain: true }])), null);
});

test('言語が文字列でない要素は langs から落とす', () => {
    const json = JSON.stringify([{ componentType: 3, isMain: true, langs: ['jpn', 1, null] }]);

    assert.deepEqual(ProgramAudioUtil.parse(json), [{ componentType: 3, isMain: true, langs: ['jpn'] }]);
});

// ---- ProgramAudioTrackUtil.getLiveAudioTracks ----

test('通常のステレオ放送では切り替えるものが無いので空配列を返す', () => {
    assert.deepEqual(ProgramAudioTrackUtil.getLiveAudioTracks([{ componentType: 3, isMain: true }]), []);
    assert.deepEqual(ProgramAudioTrackUtil.getLiveAudioTracks(undefined, 3), []);
    assert.deepEqual(ProgramAudioTrackUtil.getLiveAudioTracks([]), []);
});

test('デュアルモノラルの ES 1 本は主音声・副音声の 2 件へ展開される', () => {
    const tracks = ProgramAudioTrackUtil.getLiveAudioTracks([
        { componentType: 2, isMain: true, langs: ['jpn', 'eng'] },
    ]);

    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].track, 'main');
    assert.equal(tracks[0].name, '主音声 (日本語)');
    assert.equal(tracks[0].isDualMono, true);
    assert.equal(tracks[1].track, 'sub');
    assert.equal(tracks[1].name, '副音声 (英語)');
});

test('audios が無くても audioComponentType がデュアルモノラルなら 2 件を返す', () => {
    const tracks = ProgramAudioTrackUtil.getLiveAudioTracks(undefined, 2);

    assert.deepEqual(
        tracks.map(t => t.track),
        ['main', 'sub'],
    );
    assert.equal(tracks[0].name, '主音声');
});

test('言語が分からないデュアルモノラルは言語表記なしの名前になる', () => {
    const tracks = ProgramAudioTrackUtil.getLiveAudioTracks([{ componentType: 2, isMain: true }]);

    assert.equal(tracks[0].name, '主音声');
    assert.equal(tracks[1].name, '副音声');
});

test('音声 ES が複数ある放送は主音声を先頭に componentTag 順で並べる', () => {
    const tracks = ProgramAudioTrackUtil.getLiveAudioTracks([
        { componentType: 3, componentTag: 17, isMain: false, langs: ['eng'] },
        { componentType: 3, componentTag: 16, isMain: true, langs: ['jpn'] },
    ]);

    assert.deepEqual(
        tracks.map(t => t.track),
        ['0', '1'],
    );
    assert.equal(tracks[0].name, '主音声 (日本語)');
    assert.equal(tracks[0].language, 'jpn');
    assert.equal(tracks[1].name, '音声 2 (英語)');
});

test('複数 ES の中のデュアルモノラルはその ES だけ主音声・副音声へ展開する', () => {
    const tracks = ProgramAudioTrackUtil.getLiveAudioTracks([
        { componentType: 2, componentTag: 16, isMain: true, langs: ['jpn', 'eng'] },
        { componentType: 3, componentTag: 17, isMain: false },
    ]);

    assert.deepEqual(
        tracks.map(t => t.track),
        ['main', 'sub', '1'],
    );
});

test('知らない言語コードはコードのまま表示する', () => {
    const tracks = ProgramAudioTrackUtil.getLiveAudioTracks([{ componentType: 2, isMain: true, langs: ['qaa'] }]);

    assert.equal(tracks[0].name, '主音声 (qaa)');
});
