'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const StreamApiModel = require('../../dist/model/api/stream/StreamApiModel').default;

test('視聴用録画 HLS は encoded TS 字幕 reader 用の container=hls を渡す', async () => {
    let option = null;
    const stream = {
        setOption: value => {
            option = value;
        },
    };
    const model = new StreamApiModel(
        async () => ({}),
        async () => ({}),
        async () => ({}),
        async () => stream,
        { start: async () => 12 },
        { getRecordedProfiles: () => [] },
        {},
        { findId: async () => ({ type: 'encoded' }) },
        {},
        {},
        {},
        undefined,
        { analyzeRecordedFile: async () => ({ codec: 'hevc', transport: 'mpegts', bitDepth: 10 }) },
        {
            getFullFilePathFromId: async () => '/recorded/hevc.ts',
            hasStableSecondAudioStream: async () => true,
            getAudioTracks: async () => [
                { streamIndex: 0, isDualMono: true },
                { streamIndex: 0, isDualMono: true },
            ],
        },
    );

    const streamId = await model.startRecordedHLSStream({
        videoFileId: 31019,
        playPosition: 300,
        profile: 'original-hevc',
        mode: 0,
        audioTrack: 'all',
    });

    assert.equal(streamId, 12);
    assert.equal(option.container, 'hls');
    assert.match(option.cmd, /-filter_complex/u);
    assert.match(option.cmd, /-map "\[main_audio\]" -map "\[sub_audio\]"/u);
});

test('録画配信の profile=auto は mode で m2tsll / hls / mp4 / webm を解決する', async () => {
    const calls = [];
    const profiles = ['m2tsll', 'hls', 'mp4', 'webm'].map(container => ({
        id: `${container}-720`,
        container,
        cmd: `${container}-cmd`,
    }));
    const makeStream = () => ({
        setOption: (option, displayMode) => calls.push({ option, displayMode }),
        getStream: () => ({}),
    });
    const model = new StreamApiModel(
        async () => ({}),
        async () => ({}),
        async () => makeStream(),
        async () => makeStream(),
        { start: async () => calls.length + 1 },
        {
            getRecordedProfiles: () => profiles,
            resolveLegacyMode: (_kind, container, mode) => (mode === 0 ? profiles.find(profile => profile.container === container) ?? null : null),
        },
        {},
        { findId: async () => ({ type: 'ts' }) },
        {},
        {},
        {},
    );
    const option = { videoFileId: 31017, mode: 0, profile: 'auto', audioTrack: 'main' };

    await model.startRecordedM2TsLLStream(option);
    await model.startRecordedHLSStream(option);
    await model.startRecordedMp4Stream(option);
    await model.startRecordedWebMStream(option);

    assert.deepEqual(calls.map(call => call.option.cmd), ['m2tsll-cmd', 'hls-cmd', 'mp4-cmd', 'webm-cmd']);
});

test('録画配信の存在しない profile は ConfigIsUndefined のまま拒否する', async () => {
    const model = new StreamApiModel(
        async () => ({}),
        async () => ({}),
        async () => ({ getStream: () => ({}) }),
        async () => ({ getStream: () => ({}) }),
        { start: async () => 1 },
        { getRecordedProfiles: () => [{ id: 'known', container: 'm2tsll', cmd: 'known-cmd' }] },
        {},
        { findId: async () => ({ type: 'ts' }) },
        {},
        {},
        {},
    );

    await assert.rejects(
        () => model.startRecordedM2TsLLStream({ videoFileId: 31017, mode: 0, profile: 'missing' }),
        error => error instanceof Error && error.message === 'ConfigIsUndefined',
    );
});
