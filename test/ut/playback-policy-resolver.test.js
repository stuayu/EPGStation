'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const PlaybackPolicyResolver = require('../../dist/model/stream/resolver/PlaybackPolicyResolver').default;
const { BUILTIN_STREAM_PRESETS } = require('../../dist/util/BuiltinStreamPresets');

const source = overrides => ({
    transport: 'mpegts',
    codec: 'hevc',
    width: 3840,
    height: 2160,
    bitDepth: 10,
    scan: 'progressive',
    frameRate: 59.94,
    hdr: 'hlg',
    sourceClass: 'bs4k',
    confidence: 'high',
    ...overrides,
});
const client = overrides => ({ hevc: true, hevcMain10: true, h264: true, hdr: true, hlg: true, ...overrides });

test('BS4K と HDR 対応端末では 4K 系を推奨し理由に技術用語を出さない', () => {
    const decision = new PlaybackPolicyResolver().resolve('live', source(), client(), BUILTIN_STREAM_PRESETS);
    assert.equal(decision.output.resolution, '2160p');
    assert.equal(decision.output.hdrMode, 'preserve');
    assert.equal(decision.mode, 'video-copy');
    assert.doesNotMatch(decision.reason, /HEVC|HDR|HLG|Main10|10bit/);
});

test('BS4K と HDR 非対応端末では SDR 系へ自動 fallback する', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client({ hdr: false, hlg: false, hevcMain10: false }),
        BUILTIN_STREAM_PRESETS,
    );
    assert.equal(decision.output.hdrMode, 'sdr');
    assert.notEqual(decision.output.resolution, '2160p');
});

test('再エンコード不要な組み合わせは video-copy または direct-play になる', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'recorded-ts',
        source({ hdr: 'sdr', bitDepth: 8 }),
        client({ hevcMain10: false, hdr: false, hlg: false }),
        BUILTIN_STREAM_PRESETS,
        'original',
    );
    assert.ok(['video-copy', 'direct-play'].includes(decision.mode));
});

test('Original 相当の同一コーデック・解像度は video-copy になる', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'recorded-ts',
        source({ codec: 'h264', height: 1080, width: 1920, bitDepth: 8, hdr: 'sdr' }),
        client({ hevc: false, hevcMain10: false, hdr: false, hlg: false }),
        [
            {
                id: 'original-compatible',
                name: 'オリジナル',
                useFor: 'recorded',
                quality: 'original',
                builtin: false,
                output: { codec: 'h264', resolution: '1080p', bitDepth: 8, hdrMode: 'sdr' },
            },
        ],
        'original-compatible',
    );
    assert.equal(decision.mode, 'video-copy');
});

test('iOS HDR 対応端末は HEVC Main10/HDR プロファイルを選択できる', () => {
    const decision = new PlaybackPolicyResolver().resolve('live', source(), client(), BUILTIN_STREAM_PRESETS, '2160p-high');
    assert.equal(decision.presetId, '2160p-high');
    assert.equal(decision.output.bitDepth, 10);
    assert.equal(decision.output.hdrMode, 'preserve');
});

test('iOS HDR 非対応端末は SDR プロファイルへ自動 fallback する', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client({ hdr: false, hlg: false, hevcMain10: false }),
        BUILTIN_STREAM_PRESETS,
        '2160p-high',
    );
    assert.notEqual(decision.presetId, '2160p-high');
    assert.equal(decision.output.hdrMode, 'sdr');
});

test('BS4K 1080p HDR は Main10・10bit・59.94p・HLG を維持する', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client(),
        [
            {
                id: '1080p-hdr',
                name: '1080p HDR',
                useFor: 'live',
                quality: 'high',
                builtin: false,
                output: { codec: 'hevc', resolution: '1080p', bitDepth: 10, frameRate: 'source', hdrMode: 'preserve' },
            },
        ],
        '1080p-hdr',
    );
    assert.equal(decision.output.resolution, '1080p');
    assert.equal(decision.output.bitDepth, 10);
    assert.equal(decision.output.frameRate, 'source');
    assert.equal(decision.output.hdrMode, 'preserve');
});

test('fallbackChain は有限で選択自身を含まない', () => {
    const decision = new PlaybackPolicyResolver().resolve('live', source(), client(), BUILTIN_STREAM_PRESETS);
    assert.ok(decision.fallbackChain.length <= 3);
    assert.equal(decision.fallbackChain.includes(decision.presetId), false);
});
