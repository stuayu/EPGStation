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
    { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
    { id: '2160p-preserve', name: '4K', builtin: true, output: { codec: 'copy', resolution: 'source' } },
    { id: '1080p-sdr', name: '軽量', builtin: false, legacy: true, output: { codec: 'h264', resolution: '1080p', hdrMode: 'sdr' } },
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
        {
            getPresets: () => presets,
            getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: ['1080p-sdr', '2160p-preserve'] }),
        },
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

test('playback-options は builtin と legacy の分類を維持する', async () => {
    const result = await createModel().getLivePlaybackOptions(1, client);
    assert.equal(result.profiles.find(profile => profile.id === 'auto').builtin, true);
    assert.equal(result.profiles.find(profile => profile.id === '1080p-sdr').legacy, true);
});

test('preset id から container 別 mode を解決し、profile の並びを mode 添字にしない', async () => {
    const result = await createModel().getLivePlaybackOptions(1, client);
    assert.deepEqual(result.profiles.map(profile => profile.id), ['auto', '2160p-preserve', '1080p-sdr']);
    assert.deepEqual(result.profiles.find(profile => profile.id === 'auto').modes, { hls: 1 });
    assert.deepEqual(result.profiles.find(profile => profile.id === '2160p-preserve').modes, { hls: 1 });
    assert.deepEqual(result.profiles.find(profile => profile.id === '1080p-sdr').modes, { hls: 0 });
});

test('録画 HEVC 無変換は Original と HLS fallback の mode 0 として playback-options に出る', async () => {
    const hevcSource = { ...source, transport: 'mpegts', bitDepth: 8 };
    const original = {
        id: 'original-hevc',
        name: 'オリジナル (HEVC・無変換)',
        builtin: true,
        quality: 'original',
        output: { codec: 'copy', resolution: 'source', container: 'hls' },
    };
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => hevcSource, analyzeRecordedFile: async () => hevcSource },
        { getPresets: () => [{ ...presets[0] }, original], getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] }) },
        { resolve: (_scope, _source, _client, _presets, requested) => ({ presetId: requested === 'original-hevc' ? requested : 'original-hevc', label: 'HEVC', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'encoded', recordedId: 1 }) },
        undefined,
        {
            getFullFilePathFromId: async () => '/recorded/hevc.ts',
            hasStableSecondAudioStream: async () => true,
            getAudioTracks: async () => [
                { streamIndex: 0, isDualMono: true },
                { streamIndex: 0, isDualMono: true },
            ],
        },
    );
    const result = await model.getRecordedPlaybackOptions(1, client, 'original-hevc', 'hls');
    assert.deepEqual(result.profiles.find(profile => profile.id === 'original-hevc').modes, { original: 0, hls: 0 });
    assert.equal(result.profiles.find(profile => profile.id === 'original-hevc').role, 'original-hevc');
    assert.equal(result.profiles.find(profile => profile.id === 'original-hevc').embeddedAudioSwitch.hls, true);
    assert.equal(result.profiles.find(profile => profile.id === 'original-hevc').embeddedAudioSwitch.original, true);
});

test('録画 MPEG-2 の original profile は方式選択用 mode として返る', async () => {
    const mpeg2Source = { ...source, codec: 'mpeg2', transport: 'mpegts', height: 1080 };
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => mpeg2Source, analyzeRecordedFile: async () => mpeg2Source },
        {
            getPresets: () => [
                { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
                { id: 'original-mpeg2', name: 'MPEG-2', delivery: 'mpeg2toh264', output: { codec: 'copy', resolution: 'source' } },
            ],
            getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] }),
        },
        { resolve: (_scope, _source, _client, available) => ({ presetId: available[0].id, label: '自動', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts', recordedId: 1 }) },
    );

    const result = await model.getRecordedPlaybackOptions(1, { ...client, mpeg2toh264: true }, undefined, 'original');
    const original = result.profiles.find(profile => profile.id === 'original-mpeg2');
    assert.equal(original?.available, true);
    assert.deepEqual(original?.modes, { original: 0 });
});

test('録画 HEVC の original profile は original 方式から HLS profile として解決できる', async () => {
    const hevcSource = { ...source, codec: 'hevc', transport: 'mpegts', bitDepth: 8 };
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => hevcSource, analyzeRecordedFile: async () => hevcSource },
        {
            getPresets: () => [
                { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
                { id: 'original-hevc', name: 'HEVC', builtin: true, quality: 'original', output: { codec: 'copy', resolution: 'source', container: 'hls' } },
            ],
            getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] }),
        },
        { resolve: (_scope, _source, _client, available) => ({ presetId: available[0].id, label: '自動', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'encoded', recordedId: 1 }) },
    );

    const result = await model.getRecordedPlaybackOptions(1, client, undefined, 'original');
    const original = result.profiles.find(profile => profile.id === 'original-hevc');
    assert.equal(original?.available, true);
    assert.deepEqual(original?.modes, { original: 0, hls: 0 });
});

test('録画 HEVC の実 AAC が通常ステレオなら embeddedAudioSwitch.hls を無効にする', async () => {
    const hevcSource = { ...source, transport: 'mpegts', bitDepth: 8 };
    const original = {
        id: 'original-hevc',
        name: 'HEVC',
        builtin: true,
        quality: 'original',
        output: { codec: 'copy', resolution: 'source', container: 'hls' },
    };
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => hevcSource, analyzeRecordedFile: async () => hevcSource },
        { getPresets: () => [original], getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] }) },
        { resolve: () => ({ presetId: 'original-hevc', label: 'HEVC', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'encoded', recordedId: 1 }) },
        undefined,
        {
            getFullFilePathFromId: async () => '/recorded/hevc.ts',
            hasStableSecondAudioStream: async () => true,
            getAudioTracks: async () => [{ streamIndex: 0, isDualMono: false }],
        },
    );

    const result = await model.getRecordedPlaybackOptions(1, client, 'original-hevc', 'hls');
    assert.equal(result.profiles.find(profile => profile.id === 'original-hevc').embeddedAudioSwitch.hls, false);
});

test('録画中は MPEG-2 / HEVC Original を playback-options に出さない', async () => {
    const hevcSource = { ...source, transport: 'mpegts', bitDepth: 8 };
    const originals = [
        { id: 'original-mpeg2', name: 'MPEG-2', delivery: 'mpeg2toh264', output: { codec: 'copy', resolution: 'source' } },
        { id: 'original-hevc', name: 'HEVC', output: { codec: 'copy', resolution: 'source', container: 'hls' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => hevcSource, analyzeRecordedFile: async () => hevcSource },
        { getPresets: () => originals, getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] }) },
        { resolve: () => ({ presetId: 'original-hevc', label: 'HEVC', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts', recordedId: 9 }) },
        { findId: async () => ({ isRecording: true }) },
    );

    const result = await model.getRecordedPlaybackOptions(1, client, undefined, 'hls');

    assert.equal(result.profiles.some(profile => profile.id === 'original-mpeg2'), false);
    assert.equal(result.profiles.some(profile => profile.id === 'original-hevc'), false);
});

test('config 由来プリセットを品質バケットの代表として通常表示する', async () => {
    const configPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        ...[
            ['custom-2160', '技術名2160p', 'hevc', '2160p', 'hls'],
            ['custom-1080-hevc', '技術名1080p HEVC', 'hevc', '1080p', 'hls'],
            ['custom-1080-avc', '技術名1080p AVC', 'h264', '1080p', 'hls'],
            ['custom-720', '技術名720p', 'h264', '720p', 'hls'],
            ['custom-480', '技術名480p', 'h264', '480p', 'hls'],
            ['custom-240', '技術名240p', 'h264', '240p', 'hls'],
            ['custom-720-other', '別720p', 'h264', '720p', 'mp4'],
            ['custom-1080-other', '別1080p', 'h264', '1080p', 'mp4'],
        ].map(([id, name, codec, resolution, container]) => ({
            id,
            name,
            builtin: false,
            legacy: true,
            output: { codec, resolution, container },
        })),
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        { getPresets: () => configPresets },
        { resolve: () => ({ presetId: 'custom-1080-avc', label: '技術名1080p AVC', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const primaryCount = result.profiles.filter(profile => profile.builtin).length;
    assert.ok(primaryCount > 1 && primaryCount <= 7);
    assert.equal(result.profiles.find(profile => profile.id === 'custom-1080-avc').label, '1080p 標準');
    assert.equal(result.profiles.find(profile => profile.id === 'custom-1080-other').builtin, false);
    assert.equal(result.recommended.label, '1080p 標準');
    assert.equal(result.profiles[0].id, 'auto');
    assert.deepEqual(result.profiles.map(profile => profile.id), [
        'auto',
        'custom-2160',
        'custom-1080-hevc',
        'custom-1080-avc',
        'custom-1080-other',
        'custom-720',
        'custom-720-other',
        'custom-480',
        'custom-240',
    ]);
});

// embeddedAudioSwitch: m2tsll は tsreadex または実音声 ES 2 本以上で true になる
test('m2tsll で tsreadex 経由 (TSREADEX + AUDIOMAP を含む cmd) は embeddedAudioSwitch.m2tsll が true になる', async () => {
    const m2tsllPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'm2tsll-1080', name: 'M2TS-LL 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'm2tsll' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => m2tsllPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: ['m2tsll-1080'], mp4: [], webm: [], hls: [] }),
            resolveProfileCmd: (_scope, presetId) =>
                presetId === 'm2tsll-1080'
                    ? '%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 - | %FFMPEG% %DUALMONOMODE% -f mpegts -i pipe:0 %AUDIOMAP% -map "0:s?" -c:s copy -c:v libx264 -y -f mpegts pipe:1'
                    : undefined,
        },
        { resolve: () => ({ presetId: 'm2tsll-1080', label: 'M2TS-LL 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'm2tsll-1080');
    assert.equal(profile.embeddedAudioSwitch.m2tsll, true);
});

test('m2tsll で AUDIOSELECTMAP を使う tsreadex cmd も embeddedAudioSwitch.m2tsll が true になる', async () => {
    const m2tsllPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'm2tsll-720', name: 'M2TS-LL 720p', builtin: false, output: { codec: 'h264', resolution: '720p', container: 'm2tsll' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => m2tsllPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: ['m2tsll-720'], mp4: [], webm: [], hls: [] }),
            resolveProfileCmd: () => '%TSREADEX% | %FFMPEG% -map 0:v:0 %AUDIOSELECTMAP% -f mpegts pipe:1',
        },
        { resolve: () => ({ presetId: 'm2tsll-720', label: 'M2TS-LL 720p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'm2tsll-720');
    assert.equal(profile.embeddedAudioSwitch.m2tsll, true);
});

test('m2tsll は tsreadex 無しでも実音声 ES が 2 本なら embeddedAudioSwitch.m2tsll が true になる', async () => {
    const m2tsllPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'm2tsll-1080', name: 'M2TS-LL 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'm2tsll' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => m2tsllPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: ['m2tsll-1080'], mp4: [], webm: [], hls: [] }),
            resolveProfileCmd: () => '%FFMPEG% -map 0:v:0 %AUDIOSELECTMAP% -f mpegts pipe:1',
        },
        { resolve: () => ({ presetId: 'm2tsll-1080', label: 'M2TS-LL 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
        undefined,
        undefined,
        {
            getLiveAudioTracks: async () => [
                { track: '0', streamIndex: 0, isDualMono: false },
                { track: '1', streamIndex: 1, isDualMono: false },
            ],
        },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'm2tsll-1080');
    assert.equal(profile.embeddedAudioSwitch.m2tsll, true);
});

test('m2tsll は音声 ES が 1 本なら embeddedAudioSwitch.m2tsll が false のままになる', async () => {
    const m2tsllPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'm2tsll-1080', name: 'M2TS-LL 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'm2tsll' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => m2tsllPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: ['m2tsll-1080'], mp4: [], webm: [], hls: [] }),
            resolveProfileCmd: () => '%FFMPEG% -map 0:v:0 %AUDIOSELECTMAP% -f mpegts pipe:1',
        },
        { resolve: () => ({ presetId: 'm2tsll-1080', label: 'M2TS-LL 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
        undefined,
        undefined,
        { getLiveAudioTracks: async () => [{ track: '0', streamIndex: 0, isDualMono: true }] },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'm2tsll-1080');
    assert.equal(profile.embeddedAudioSwitch.m2tsll, false);
});

test('m2tsll でも tsreadex 無し (AUDIOMAP を含まない cmd) は embeddedAudioSwitch.m2tsll が false になる', async () => {
    const m2tsllPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'm2tsll-1080', name: 'M2TS-LL 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'm2tsll' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => m2tsllPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: ['m2tsll-1080'], mp4: [], webm: [], hls: [] }),
            resolveProfileCmd: (_scope, presetId) =>
                presetId === 'm2tsll-1080'
                    ? '%FFMPEG% %DUALMONOMODE% -f mpegts -i pipe:0 -map 0:v:0 -map 0:a -map "0:s?" -c:s copy -c:v libx264 -y -f mpegts pipe:1'
                    : undefined,
        },
        { resolve: () => ({ presetId: 'm2tsll-1080', label: 'M2TS-LL 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'm2tsll-1080');
    assert.equal(profile.embeddedAudioSwitch.m2tsll, false);
});

test('hls は tsreadex 無し (AUDIOMAP のみ) の cmd では embeddedAudioSwitch.hls が false になる', async () => {
    const hlsPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'hls-1080', name: 'HLS 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'hls' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => hlsPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: ['hls-1080'] }),
            resolveProfileCmd: () =>
                '%FFMPEG% %DUALMONOMODE% %AUDIOMAP% -sn -map 0 -f hls %OUTPUT%',
        },
        { resolve: () => ({ presetId: 'hls-1080', label: 'HLS 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'hls-1080');
    assert.equal(profile.embeddedAudioSwitch.hls, false);
});

test('hls は tsreadex 無しでも番組情報で音声 ES が 2 本なら embeddedAudioSwitch.hls が true になる', async () => {
    const hlsPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'hls-1080', name: 'HLS 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'hls' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => hlsPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: ['hls-1080'] }),
            resolveProfileCmd: () => '%FFMPEG% %DUALMONOMODE% %AUDIOMAP% -f mp4 pipe:1',
        },
        { resolve: () => ({ presetId: 'hls-1080', label: 'HLS 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
        undefined,
        undefined,
        {
            getLiveAudioTracks: async () => [
                { track: '0', streamIndex: 0, isDualMono: false },
                { track: '1', streamIndex: 1, isDualMono: false },
            ],
        },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'hls-1080');
    assert.equal(profile.embeddedAudioSwitch.hls, true);
});

test('hls は tsreadex 経由 (TSREADEX + AUDIOMAP) かつ in-memory (streamFileDir を含まない) なら embeddedAudioSwitch.hls が true になる', async () => {
    const hlsPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'hls-1080', name: 'HLS 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'hls' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => hlsPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: ['hls-1080'] }),
            resolveProfileCmd: () =>
                '%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 - | %FFMPEG% %DUALMONOMODE% %AUDIOMAP% -f mp4 pipe:1',
        },
        { resolve: () => ({ presetId: 'hls-1080', label: 'HLS 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'hls-1080');
    assert.equal(profile.embeddedAudioSwitch.hls, true);
});

test('hls は tsreadex 経由でもディスク方式 (streamFileDir を含む) なら embeddedAudioSwitch.hls が false になる', async () => {
    const hlsPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'hls-1080', name: 'HLS 1080p', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'hls' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => source },
        {
            getPresets: () => hlsPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: [], mp4: [], webm: [], hls: ['hls-1080'] }),
            resolveProfileCmd: () =>
                '%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 - | %FFMPEG% %DUALMONOMODE% %AUDIOMAP% -f hls %streamFileDir%/stream%streamNum%-%09d.ts %OUTPUT%',
        },
        { resolve: () => ({ presetId: 'hls-1080', label: 'HLS 1080p', reason: 'test', fallbackChain: [] }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === 'hls-1080');
    assert.equal(profile.embeddedAudioSwitch.hls, false);
});

// 旧いテストダブル (resolveProfileCmd を持たない presetRegistry) でも例外にならない
test('presetRegistry.resolveProfileCmd が無い場合は embeddedAudioSwitch を false 扱いにする', async () => {
    const result = await createModel().getLivePlaybackOptions(1, client);
    const profile = result.profiles.find(p => p.id === '2160p-preserve');
    assert.equal(profile.embeddedAudioSwitch === undefined || profile.embeddedAudioSwitch.hls === false, true);
});

test('container 指定時は同じ container 内の品質バケット代表を選ぶ', async () => {
    const containerPresets = [
        { id: 'auto', name: '自動', builtin: true, output: { codec: 'copy', resolution: 'source' } },
        { id: 'hls-1080', name: 'HLS 1080p 技術名', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'hls' } },
        { id: 'hls-720', name: 'HLS 720p 技術名', builtin: false, output: { codec: 'h264', resolution: '720p', container: 'hls' } },
        { id: 'hls-480', name: 'HLS 480p 技術名', builtin: false, output: { codec: 'h264', resolution: '480p', container: 'hls' } },
        { id: 'm2tsll-1080', name: 'M2TS-LL 1080p 技術名', builtin: false, output: { codec: 'h264', resolution: '1080p', container: 'm2tsll' } },
        { id: 'm2tsll-720', name: 'M2TS-LL 720p 技術名', builtin: false, output: { codec: 'h264', resolution: '720p', container: 'm2tsll' } },
    ];
    const model = new PlaybackApiModel(
        { analyzeLiveChannel: async () => ({ ...source, codec: 'h264', height: 1080, hdr: 'sdr' }) },
        {
            getPresets: () => containerPresets,
            getModeMap: () => ({ m2ts: [], m2tsll: ['m2tsll-1080', 'm2tsll-720'], mp4: [], webm: [], hls: ['hls-1080', 'hls-720', 'hls-480'] }),
        },
        { resolve: (_scope, _source, _client, available) => ({ presetId: available.find(p => p.id === 'hls-1080')?.id ?? 'auto', label: 'HLS 1080p 技術名', reason: 'test', fallbackChain: available.filter(p => p.id !== 'auto').map(p => p.id) }) },
        { findId: async () => ({ type: 'ts' }) },
    );

    const result = await model.getLivePlaybackOptions(1, { ...client, hevc: false }, undefined, 'hls');
    assert.deepEqual(result.profiles.map(profile => profile.id), ['auto', 'hls-1080', 'hls-720', 'hls-480']);
    assert.deepEqual(result.profiles.map(profile => profile.label), ['自動・おすすめ', '1080p 標準', '720p', 'データ節約']);
    assert.equal(result.profiles.every(profile => typeof profile.modes.hls === 'number'), true);
    assert.equal(result.profiles.some(profile => typeof profile.modes.m2tsll === 'number'), false);
    assert.equal(result.profiles.some(profile => profile.id === 'm2tsll-1080'), false);
});
