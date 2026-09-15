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

test('オフライン保存の encoded HEVC 複数音声だけ tsreadex 前段化し、オンライン視聴と単一音声は変えない', async () => {
    let option = null;
    let tracks = [
        { streamIndex: 0, isDualMono: false },
        { streamIndex: 1, isDualMono: false },
    ];
    const stream = {
        setOption: value => {
            option = value;
        },
        getStream: () => ({}),
    };
    const model = new StreamApiModel(
        async () => ({}),
        async () => ({}),
        async () => ({}),
        async () => stream,
        { start: async () => 13 },
        { getRecordedProfiles: () => [] },
        {},
        { findId: async () => ({ type: 'encoded' }) },
        {},
        {},
        {},
        { getConfig: () => ({ tsreadex: 'C:\\tools\\tsreadex.exe' }) },
        { analyzeRecordedFile: async () => ({ codec: 'hevc', transport: 'mpegts', bitDepth: 10 }) },
        {
            getFullFilePathFromId: async () => 'F:\\EPGStation\\encode\\commentary (11)＜副音声＞.hevc.ts',
            hasStableSecondAudioStream: async () => true,
            getAudioTracks: async () => tracks,
        },
    );

    await model.startRecordedHLSStream({
        videoFileId: 23023,
        playPosition: 300,
        profile: 'original-hevc',
        mode: 0,
        audioTrack: 'all',
    });
    assert.doesNotMatch(option.cmd, /%TSREADEX%/u);
    assert.match(option.cmd, /-ss %SS% -i %INPUT%/u);

    await model.startRecordedOfflineHLSStream({
        videoFileId: 23023,
        playPosition: 999,
        profile: 'original-hevc',
        mode: 0,
        audioTrack: 'all',
    });
    assert.match(option.cmd, /%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 %INPUT% \|/u);
    assert.doesNotMatch(option.cmd, /-ss %SS%/u);
    assert.match(option.cmd, /%AUDIOMAP%/u);
    assert.equal(option.playPosition, 0);

    tracks = [{ streamIndex: 0, isDualMono: false }];
    await model.startRecordedOfflineHLSStream({
        videoFileId: 23023,
        playPosition: 999,
        profile: 'original-hevc',
        mode: 0,
        audioTrack: 'all',
    });
    assert.doesNotMatch(option.cmd, /%TSREADEX%/u);
    assert.match(option.cmd, /-ss %SS% -i %INPUT%/u);
    assert.match(option.cmd, /-map 0:v:0 -map 0:a:0\?/u);
    assert.doesNotMatch(option.cmd, /-map 0:a:1|-filter_complex/u);
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
