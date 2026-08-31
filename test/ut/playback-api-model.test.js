'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const PlaybackApiModel = require('../../dist/model/api/stream/PlaybackApiModel').default;

const source = {
    codec: 'hevc',
    height: 2160,
    scan: 'progressive',
    hdr: 'hlg',
    sourceClass: 'bs4k',
    confidence: 'high',
};
const client = { hevc: true, hevcMain10: true, h264: true, hdr: true, hlg: true };
const presets = [
    { id: '2160p-preserve', name: '4K', output: { codec: 'copy', resolution: 'source' } },
    { id: '1080p-sdr', name: '軽量', output: { codec: 'h264', resolution: '1080p', hdrMode: 'sdr' } },
];

const createModel = () => {
    const decision = {
        presetId: '2160p-preserve',
        label: '4K',
        reason: '元の映像を活かして再生できます',
        fallbackChain: ['1080p-sdr'],
    };
    return new PlaybackApiModel(
        {
            analyzeLiveChannel: async () => source,
            analyzeRecordedFile: async () => source,
        },
        { getPresets: () => presets },
        { resolve: () => decision },
        { findId: async () => ({ type: 'ts' }) },
    );
};

test('live playback-options は Resolver の fallbackChain を返す', async () => {
    const result = await createModel().getLivePlaybackOptions(1, client);
    assert.deepEqual(result.recommended.fallbackChain, ['1080p-sdr']);
});

test('recorded playback-options は Resolver の fallbackChain を返す', async () => {
    const result = await createModel().getRecordedPlaybackOptions(1, client);
    assert.deepEqual(result.recommended.fallbackChain, ['1080p-sdr']);
});
