'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlaybackQualityOptions } = require('../../dist/util/PlaybackQualityOptionUtil');

const profile = (id, modes) => ({
    id,
    role: id,
    label: id,
    detail: '',
    available: true,
    builtin: true,
    legacy: false,
    modes,
});

test('modes に存在する方式と画質の組み合わせだけを作る', () => {
    const result = createPlaybackQualityOptions(
        [profile('auto', { hls: 0, m2tsll: 1 }), profile('1080p', { hls: 2 })],
        ['hls', 'm2tsll'],
        'hls',
        2,
    );

    assert.deepEqual(
        result.options.map(option => [option.container, option.profile.id, option.mode]),
        [
            ['hls', 'auto', 0],
            ['hls', '1080p', 2],
            ['m2tsll', 'auto', 1],
        ],
    );
});

test('端末非対応の配信方式を一覧から除外する', () => {
    const result = createPlaybackQualityOptions(
        [profile('1080p', { hls: 0, m2tsll: 0, mp4: 1 })],
        ['hls', 'mp4'],
        'hls',
        0,
    );

    assert.deepEqual(result.options.map(option => option.container), ['hls', 'mp4']);
    assert.equal(result.options.some(option => option.container === 'm2tsll'), false);
});

test('現在の container と mode の組み合わせを選択中として特定する', () => {
    const result = createPlaybackQualityOptions(
        [profile('1080p', { hls: 0, m2tsll: 0 }), profile('720p', { hls: 1, m2tsll: 1 })],
        ['hls', 'm2tsll'],
        'm2tsll',
        1,
        '1080p',
    );

    assert.equal(result.currentIndex, 3);
    assert.deepEqual(result.options[result.currentIndex], {
        profile: profile('720p', { hls: 1, m2tsll: 1 }),
        container: 'm2tsll',
        mode: 1,
    });
});

const { disambiguatePlaybackLabels } = require('../../dist/util/PlaybackQualityOptionUtil');

test('表示名が衝突するものだけコーデック名で区別する', () => {
    const labels = ['低遅延 (M2TS-LL) > 720p', '低遅延 (M2TS-LL) > 720p', '標準 (HLS) > 1080p 高画質'];
    const profiles = [{ videoCodec: 'hevc' }, { videoCodec: 'h264' }, { videoCodec: 'hevc' }];

    assert.deepEqual(disambiguatePlaybackLabels(labels, profiles), [
        '低遅延 (M2TS-LL) > 720p (HEVC)',
        '低遅延 (M2TS-LL) > 720p (H.264)',
        '標準 (HLS) > 1080p 高画質',
    ]);
});

test('コーデックが分からない重複はラベルを変えない', () => {
    const labels = ['MP4 > 720p', 'MP4 > 720p'];

    assert.deepEqual(disambiguatePlaybackLabels(labels, [{}, {}]), labels);
});
