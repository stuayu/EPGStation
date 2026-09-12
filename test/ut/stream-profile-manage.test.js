'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const StreamProfileManageModel = require('../../dist/model/stream/StreamProfileManageModel').default;
const AudioTrackUtil = require('../../dist/model/service/stream/util/AudioTrackUtil').default;

test('m2tsll の生成 cmd は入力オプションを -i より前、low_delay を出力側へ置く', () => {
    const model = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    live: [
                        {
                            id: 'm2tsll-test',
                            name: 'test',
                            container: 'm2tsll',
                            video: { codec: 'libx264', height: 720, bitrate: 2000 },
                            audio: { codec: 'aac', bitrate: 128 },
                        },
                    ],
                },
            },
        }),
    });
    const cmd = model.getLiveProfiles()[0].cmd;
    const input = cmd.indexOf('-i pipe:0');

    assert.ok(cmd.indexOf('-analyzeduration 500000') < input);
    assert.ok(cmd.indexOf('-probesize 500000') < input);
    assert.ok(cmd.indexOf('-fflags nobuffer') < input);
    assert.ok(cmd.indexOf('-flags low_delay') > input);
});

test('tsreadex 経由の m2tsll だけ入力解析を 200000 へ短縮し、非経由は従来値を維持する', () => {
    const makeModel = tsreadex =>
        new StreamProfileManageModel({
            getConfig: () => ({
                tsreadex: tsreadex === true ? '/usr/local/bin/tsreadex' : undefined,
                stream: {
                    profiles: {
                        live: [
                            {
                                id: 'm2tsll-test',
                                name: 'test',
                                container: 'm2tsll',
                                video: { codec: 'libx264', height: 720, bitrate: 2000 },
                                audio: { codec: 'aac', bitrate: 128 },
                            },
                        ],
                    },
                },
            }),
        });

    assert.match(makeModel(true).getLiveProfiles()[0].cmd, /-analyzeduration 200000 -probesize 200000/);
    assert.match(makeModel(false).getLiveProfiles()[0].cmd, /-analyzeduration 500000 -probesize 500000/);
});

test('録画 m2tsll は ts と encoded で入力方式とシークを分ける', () => {
    const model = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    recorded: {
                        ts: [{ id: 'recorded-ts-ll', name: 'TS', container: 'm2tsll', video: { height: 720 } }],
                        encoded: [
                            { id: 'recorded-encoded-ll', name: 'encoded', container: 'm2tsll', video: { height: 720 } },
                        ],
                    },
                },
            },
        }),
    });

    const ts = model.getRecordedProfiles('ts')[0];
    const encoded = model.getRecordedProfiles('encoded')[0];
    assert.match(ts.cmd, /-i pipe:0/);
    assert.match(ts.cmd, /-f mpegts .* -i pipe:0/);
    assert.match(ts.cmd, /%AUDIOSELECTMAP%/);
    assert.match(encoded.cmd, /-ss %SS% -i %INPUT%/);
    assert.doesNotMatch(encoded.cmd, /-f mpegts .* -ss %SS% -i %INPUT%/);
    assert.match(encoded.cmd, /%AUDIOSELECTMAP%/);
});

test('録画 m2tsll / mp4 / webm は readrate を使い、ライブと録画 HLS は使わない', () => {
    const model = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    live: [{ id: 'live-mp4', name: 'live', container: 'mp4', video: { height: 720 } }],
                    recorded: {
                        ts: ['m2tsll', 'mp4', 'webm', 'hls'].map(container => ({
                            id: `recorded-ts-${container}`,
                            name: container,
                            container,
                            video: { height: 720 },
                        })),
                        encoded: [],
                    },
                },
            },
        }),
    });

    assert.doesNotMatch(model.getLiveProfiles()[0].cmd, /-readrate/u);
    for (const profile of model.getRecordedProfiles('ts')) {
        if (profile.container === 'hls') assert.doesNotMatch(profile.cmd, /-readrate/u);
        else assert.match(profile.cmd, /-readrate 1\.5 -readrate_initial_burst 45 -readrate_catchup 2/u);
    }
});

test('録画の全コンテナは音声トラック切り替え用プレースホルダを生成する', () => {
    const model = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    recorded: {
                        ts: ['m2ts', 'm2tsll', 'mp4', 'webm', 'hls'].map(container => ({
                            id: `recorded-ts-${container}`,
                            name: container,
                            container,
                            video: { height: 720 },
                            audio: { bitrate: 128 },
                        })),
                        encoded: ['m2ts', 'm2tsll', 'mp4', 'webm', 'hls'].map(container => ({
                            id: `recorded-encoded-${container}`,
                            name: container,
                            container,
                            video: { height: 720 },
                            audio: { bitrate: 128 },
                        })),
                    },
                },
            },
        }),
    });

    for (const profile of [...model.getRecordedProfiles('ts'), ...model.getRecordedProfiles('encoded')]) {
        assert.match(profile.cmd, /%DUALMONOMODE%/u, profile.id);
        assert.match(profile.cmd, /%AUDIOFILTER%/u, profile.id);
        assert.match(profile.cmd, /%DEINTERLACE%/u, profile.id);
        if (profile.container === 'm2tsll') {
            assert.match(profile.cmd, /%AUDIOSELECTMAP%/u, profile.id);
        } else {
            assert.match(profile.cmd, /%AUDIOMAP%/u, profile.id);
        }
    }
});

test('ライブと録画の cmd 省略プリセットは全コンテナでデインターレース用プレースホルダを生成する', () => {
    const model = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    live: ['m2ts', 'm2tsll', 'mp4', 'webm', 'hls'].map(container => ({
                        id: `live-${container}`,
                        name: container,
                        container,
                        video: { height: 720 },
                    })),
                    recorded: {
                        ts: [],
                        encoded: ['m2ts', 'm2tsll', 'mp4', 'webm', 'hls'].map(container => ({
                            id: `recorded-encoded-${container}`,
                            name: container,
                            container,
                            video: { height: 720 },
                        })),
                    },
                },
            },
        }),
    });

    for (const profile of [...model.getLiveProfiles(), ...model.getRecordedProfiles('encoded')]) {
        assert.match(profile.cmd, /%DEINTERLACE%/u, profile.id);
    }
});

test('録画の全コンテナで sub が生成 cmd の音声指定へ展開される', () => {
    const model = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    recorded: {
                        ts: ['m2ts', 'm2tsll', 'mp4', 'webm', 'hls'].map(container => ({
                            id: `recorded-ts-${container}`,
                            name: container,
                            container,
                            video: { height: 720 },
                            audio: { bitrate: 128 },
                        })),
                        encoded: ['m2ts', 'm2tsll', 'mp4', 'webm', 'hls'].map(container => ({
                            id: `recorded-encoded-${container}`,
                            name: container,
                            container,
                            video: { height: 720 },
                            audio: { bitrate: 128 },
                        })),
                    },
                },
            },
        }),
    });

    for (const [type, profiles] of [
        ['ts', model.getRecordedProfiles('ts')],
        ['encoded', model.getRecordedProfiles('encoded')],
    ]) {
        for (const profile of profiles) {
            const cmd = AudioTrackUtil.replacePlaceholders(profile.cmd, 'sub', undefined, type);
            assert.doesNotMatch(cmd, /%(?:DUALMONOMODE|AUDIOMAP|AUDIOSELECTMAP|AUDIOFILTER)%/u, profile.id);
            if (type === 'encoded') {
                assert.match(cmd, /-af "pan=stereo\|c0=c1\|c1=c1(?:,volume=2)?"/u, profile.id);
            } else {
                assert.match(cmd, /-dual_mono_mode sub/u, profile.id);
            }
        }
    }
});

test('生成 cmd の optional map 引用符はシェル経由のときだけ付く', () => {
    const makeModel = tsreadex =>
        new StreamProfileManageModel({
            getConfig: () => ({
                tsreadex: tsreadex === true ? '/usr/local/bin/tsreadex' : undefined,
                stream: {
                    profiles: {
                        live: ['m2tsll', 'hls', 'mp4', 'webm'].map(container => ({
                            id: `live-${container}`,
                            name: container,
                            container,
                            video: { height: 720 },
                            audio: { bitrate: 128 },
                        })),
                        recorded: {
                            ts: ['m2tsll', 'hls', 'mp4', 'webm'].map(container => ({
                                id: `recorded-ts-${container}`,
                                name: container,
                                container,
                                video: { height: 720 },
                                audio: { bitrate: 128 },
                            })),
                            encoded: ['m2tsll', 'hls', 'mp4', 'webm'].map(container => ({
                                id: `recorded-encoded-${container}`,
                                name: container,
                                container,
                                video: { height: 720 },
                                audio: { bitrate: 128 },
                            })),
                        },
                    },
                },
            }),
        });

    const withoutTsreadex = makeModel(false);
    const directSpawnProfiles = [
        ...withoutTsreadex.getLiveProfiles(),
        ...withoutTsreadex.getRecordedProfiles('ts'),
        ...withoutTsreadex.getRecordedProfiles('encoded'),
    ];
    for (const profile of directSpawnProfiles) {
        assert.doesNotMatch(profile.cmd, /"0:(?:s\?|i:0x1ffe\?)"/u, profile.id);
        assert.doesNotMatch(profile.cmd, /0:i:0x1ffe\?/u, profile.id);
    }

    const withTsreadex = makeModel(true);
    for (const profile of [...withTsreadex.getLiveProfiles(), ...withTsreadex.getRecordedProfiles('ts')]) {
        assert.match(profile.cmd, /\|/u, profile.id);
    }
    assert.match(withTsreadex.getLiveProfiles()[0].cmd, /-map "0:s\?"/u);
    assert.match(withTsreadex.getRecordedProfiles('ts')[0].cmd, /-map "0:s\?"/u);
    for (const profile of [...withTsreadex.getLiveProfiles(), ...withTsreadex.getRecordedProfiles('ts')]) {
        assert.doesNotMatch(profile.cmd, /0:i:0x1ffe\?/u, profile.id);
    }
    for (const profile of withTsreadex.getRecordedProfiles('encoded')) {
        assert.doesNotMatch(profile.cmd, /\|/u, profile.id);
        assert.doesNotMatch(profile.cmd, /"0:(?:s\?|i:0x1ffe\?)"/u, profile.id);
    }
});
