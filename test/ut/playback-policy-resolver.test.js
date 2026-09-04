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
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client(),
        BUILTIN_STREAM_PRESETS,
        '2160p-high',
    );
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

test('auto の fallbackChain は選択品質以下の利用可能な全候補を含む', () => {
    const presets = [
        {
            id: 'auto',
            name: '自動',
            useFor: 'both',
            quality: 'highest',
            builtin: true,
            output: { codec: 'h264', resolution: 'source' },
        },
        {
            id: 'original',
            name: 'Original',
            useFor: 'both',
            quality: 'original',
            builtin: false,
            output: { codec: 'copy', resolution: 'source' },
        },
        {
            id: '1080p',
            name: '1080p',
            useFor: 'both',
            quality: 'balanced',
            builtin: false,
            output: { codec: 'h264', resolution: '1080p' },
        },
        {
            id: '720p',
            name: '720p',
            useFor: 'both',
            quality: 'balanced',
            builtin: false,
            output: { codec: 'h264', resolution: '720p' },
        },
        {
            id: '480p',
            name: '480p',
            useFor: 'both',
            quality: 'compact',
            builtin: false,
            output: { codec: 'h264', resolution: '480p' },
        },
    ];
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source({ codec: 'h264', bitDepth: 8, hdr: 'sdr' }),
        client(),
        presets,
    );
    const usableIds = presets.filter(preset => preset.id !== 'auto').map(preset => preset.id);
    assert.deepEqual([decision.presetId, ...decision.fallbackChain].sort(), usableIds.sort());
    assert.equal(decision.fallbackChain.includes(decision.presetId), false);
});

test('auto の fallbackChain は解像度・quality・videoBitrate が低負荷方向へ単調に並ぶ', () => {
    const presets = [
        {
            id: 'auto',
            name: '自動',
            useFor: 'both',
            quality: 'highest',
            builtin: true,
            output: { codec: 'h264', resolution: 'source' },
        },
        {
            id: '1080-high',
            name: '1080 high',
            useFor: 'both',
            quality: 'high',
            builtin: false,
            output: { codec: 'h264', resolution: '1080p', videoBitrate: 8000 },
        },
        {
            id: '1080-balanced-6m',
            name: '1080 balanced 6M',
            useFor: 'both',
            quality: 'balanced',
            builtin: false,
            output: { codec: 'h264', resolution: '1080p', videoBitrate: 6000 },
        },
        {
            id: '1080-balanced-3m',
            name: '1080 balanced 3M',
            useFor: 'both',
            quality: 'balanced',
            builtin: false,
            output: { codec: 'h264', resolution: '1080p', videoBitrate: 3000 },
        },
        {
            id: '720-high',
            name: '720 high',
            useFor: 'both',
            quality: 'high',
            builtin: false,
            output: { codec: 'h264', resolution: '720p', videoBitrate: 4000 },
        },
        {
            id: '480-compact',
            name: '480 compact',
            useFor: 'both',
            quality: 'compact',
            builtin: false,
            output: { codec: 'h264', resolution: '480p', videoBitrate: 900 },
        },
    ];
    const decision = new PlaybackPolicyResolver().resolve('live', source({ hdr: 'sdr' }), client(), presets);
    assert.equal(decision.presetId, '1080-high');
    assert.deepEqual(decision.fallbackChain, ['1080-balanced-6m', '1080-balanced-3m', '720-high', '480-compact']);
});

test('auto が低画質から開始した場合は fallback で高解像度へ上がらない', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client({ network: 'cellular' }),
        BUILTIN_STREAM_PRESETS,
        'auto',
        { saveData: true },
    );
    assert.equal(decision.output.resolution, '480p');
    assert.deepEqual(decision.fallbackChain, []);
});

test('auto の fallback は同解像度の高品質・高 bitrate へ戻らない', () => {
    const presets = [
        {
            id: 'auto',
            name: '自動',
            useFor: 'both',
            quality: 'highest',
            builtin: true,
            output: { codec: 'h264', resolution: 'source' },
        },
        {
            id: 'selected',
            name: '選択',
            useFor: 'both',
            quality: 'balanced',
            builtin: false,
            output: { codec: 'copy', resolution: '1080p', videoBitrate: 3000 },
        },
        {
            id: 'higher-quality',
            name: '高品質',
            useFor: 'both',
            quality: 'high',
            builtin: false,
            output: { codec: 'hevc', resolution: '1080p', videoBitrate: 2000 },
        },
        {
            id: 'higher-bitrate',
            name: '高 bitrate',
            useFor: 'both',
            quality: 'balanced',
            builtin: false,
            output: { codec: 'h264', resolution: '1080p', videoBitrate: 6000 },
        },
        {
            id: 'lower-bitrate',
            name: '低 bitrate',
            useFor: 'both',
            quality: 'balanced',
            builtin: false,
            output: { codec: 'h264', resolution: '1080p', videoBitrate: 1500 },
        },
        {
            id: 'lower-resolution',
            name: '低解像度',
            useFor: 'both',
            quality: 'high',
            builtin: false,
            output: { codec: 'h264', resolution: '720p', videoBitrate: 4000 },
        },
    ];
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source({ hdr: 'sdr', codec: 'h264', bitDepth: 8, height: 1080, width: 1920 }),
        client(),
        presets,
    );
    assert.equal(decision.presetId, 'selected');
    assert.deepEqual(decision.fallbackChain, ['lower-bitrate', 'lower-resolution']);
});

test('明示選択の fallbackChain は従来どおり最大3件', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client(),
        BUILTIN_STREAM_PRESETS,
        '2160p-high',
    );
    assert.equal(decision.fallbackChain.length, 3);
});

test('1080i source の auto 理由は選択した解像度を説明する', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source({
            codec: 'mpeg2',
            width: 1920,
            height: 1080,
            bitDepth: 8,
            scan: 'interlaced',
            hdr: 'sdr',
            sourceClass: 'legacy-broadcast',
        }),
        client({ hevc: false, hevcMain10: false, hdr: false, hlg: false }),
        BUILTIN_STREAM_PRESETS,
    );
    assert.notEqual(decision.output.resolution, '2160p');
    assert.doesNotMatch(decision.reason, /安定して再生できる画質を選択しました/);
});

test('端末設定の HDR = SDR に変換 は自動選択で SDR 系を選ぶ', () => {
    const decision = new PlaybackPolicyResolver().resolve('live', source(), client(), BUILTIN_STREAM_PRESETS, 'auto', {
        hdrMode: 'sdr',
    });
    assert.equal(decision.output.hdrMode, 'sdr');
});

test('端末設定の HDR = 維持 は自動選択で HDR 系を選ぶ', () => {
    const decision = new PlaybackPolicyResolver().resolve('live', source(), client(), BUILTIN_STREAM_PRESETS, 'auto', {
        hdrMode: 'preserve',
    });
    assert.equal(decision.output.hdrMode, 'preserve');
});

test('モバイル回線では画質を下げる設定は cellular のときだけ効く', () => {
    const cellular = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client({ network: 'cellular' }),
        BUILTIN_STREAM_PRESETS,
        'auto',
        { saveData: true },
    );
    const fast = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client({ network: 'fast' }),
        BUILTIN_STREAM_PRESETS,
        'auto',
        { saveData: true },
    );
    assert.equal(cellular.output.resolution, '480p');
    assert.equal(fast.output.resolution, '2160p');
});

test('端末設定は明示的なプリセット指定を上書きしない', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client({ network: 'cellular' }),
        BUILTIN_STREAM_PRESETS,
        '2160p-high',
        { saveData: true, hdrMode: 'sdr' },
    );
    assert.equal(decision.presetId, '2160p-high');
});

test('モバイル回線では画質を下げる設定は fallback 候補も低画質順にする', () => {
    const decision = new PlaybackPolicyResolver().resolve(
        'live',
        source(),
        client({ network: 'cellular' }),
        BUILTIN_STREAM_PRESETS,
        'auto',
        { saveData: true },
    );
    const heights = decision.fallbackChain.map(id => {
        const preset = BUILTIN_STREAM_PRESETS.find(item => item.id === id);
        return preset.output.resolution === 'source' ? 2160 : Number.parseInt(preset.output.resolution, 10);
    });
    assert.deepEqual(
        [...heights].sort((a, b) => a - b),
        heights,
        `fallbackChain=${decision.fallbackChain}`,
    );
});
