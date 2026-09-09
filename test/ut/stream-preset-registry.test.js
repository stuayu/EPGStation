'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const StreamPresetRegistry = require('../../dist/model/stream/preset/StreamPresetRegistry').default;
const StreamProfileManageModel = require('../../dist/model/stream/StreamProfileManageModel').default;

const source = (overrides = {}) => ({
    codec: 'mpeg2',
    height: 1080,
    scan: 'interlaced',
    hdr: 'sdr',
    sourceClass: 'legacy-broadcast',
    confidence: 'high',
    ...overrides,
});
const client = (overrides = {}) => ({ hevc: true, hevcMain10: true, h264: true, hdr: true, hlg: true, ...overrides });
const config = stream => ({ stream });
const makeRegistry = value => {
    const configuration = { getConfig: () => value };
    const profileModel = new StreamProfileManageModel(configuration);
    return new StreamPresetRegistry(configuration, profileModel);
};

test('ユーザー定義プリセットは同じ役割の Built-in に上書きされない', () => {
    const registry = makeRegistry(config({ profiles: { live: [{ id: 'custom-720p', name: '自分の720p', container: 'hls', video: { codec: 'libx264', height: 720 } }] } }));
    const preset = registry.getPresets('live', source(), client()).find(item => item.output.resolution === '720p');
    assert.equal(preset.id, 'custom-720p');
    assert.equal(preset.name, '自分の720p');
});

test('既存 mode の添字は container ごとの preset id に決定的に対応する', () => {
    const registry = makeRegistry(config({ live: { ts: { mp4: [{ name: 'A' }, { name: 'B' }] } } }));
    assert.deepEqual(registry.getModeMap('live').mp4, ['live-mp4-0', 'live-mp4-1']);
    assert.equal(registry.resolveMode('live', 'mp4', 1), 'live-mp4-1');
});

test('1080i legacy source では 2160p-high を候補に出さない', () => {
    const registry = makeRegistry(config());
    assert.equal(registry.getPresets('live', source({ height: 1080 }), client()).some(item => item.id === '2160p-high'), false);
});

test('HEVC 非対応 client では HEVC 必須プリセットを候補に出さない', () => {
    const registry = makeRegistry(config());
    const ids = registry.getPresets('live', source({ height: 2160, hdr: 'hlg' }), client({ hevc: false, hevcMain10: false })).map(item => item.id);
    assert.equal(ids.includes('2160p-high'), false);
    assert.equal(ids.includes('1080p-high'), false);
});

test('1080i source では config と legacy の 2160p を候補に出さない', () => {
    const configuration = config({
        stream: {
            profiles: {
                live: [{ id: 'custom-2160p', name: '自作2160p', container: 'hls', video: { codec: 'libx264', height: 2160 } }],
            },
        },
    });
    const registry = makeRegistry(configuration);
    const ids = registry.getPresets('live', source({ height: 1080 }), client()).map(item => item.id);
    assert.equal(ids.includes('custom-2160p'), false);
    assert.equal(ids.includes('legacy-stuayu-2160p'), false);
});

test('HEVC を cmd から推定し非対応 client では config プリセットを候補に出さない', () => {
    const registry = makeRegistry(config({
        stream: { profiles: { live: [{ id: 'custom-hevc', name: '自作高画質', container: 'hls', cmd: 'ffmpeg -c:v libx265 pipe:1' }] } },
    }));
    const ids = registry.getPresets('live', source(), client({ hevc: false })).map(item => item.id);
    assert.equal(ids.includes('custom-hevc'), false);
});

test('builtin と legacy を候補で区別して返す', () => {
    const registry = makeRegistry(config());
    const presets = registry.getPresets('live', source(), client());
    assert.equal(presets.find(item => item.id === '1080p').builtin, true);
    assert.equal(presets.find(item => item.id === 'legacy-stuayu-240p').legacy, true);
});

test('既存 stream 設定だけの環境は従来のプリセットと生成 cmd をそのまま使う', () => {
    const legacyCmd = '%FFMPEG% -i pipe:0 -c:v copy -f mpegts pipe:1';
    const configuration = {
        stream: {
            profiles: {
                live: [
                    { id: 'manual-live', name: '従来ライブ', container: 'm2ts', cmd: legacyCmd },
                    {
                        id: 'generated-live',
                        name: '従来生成720p',
                        container: 'mp4',
                        video: { codec: 'libx264', height: 720, bitrate: 2500 },
                        audio: { codec: 'aac', bitrate: 128 },
                    },
                ],
            },
        },
    };
    const profiles = new StreamProfileManageModel({ getConfig: () => configuration });
    const registry = new StreamPresetRegistry({ getConfig: () => configuration }, profiles);
    const candidates = registry.getPresets('live', source(), client());

    assert.deepEqual(profiles.getLiveProfiles().map(profile => profile.id), ['manual-live', 'generated-live']);
    assert.equal(profiles.getLiveProfiles()[0].cmd, legacyCmd);
    assert.equal(
        profiles.getLiveProfiles()[1].cmd,
        '%FFMPEG% -re %DUALMONOMODE% -i pipe:0 -sn -threads 0 %AUDIOMAP% -c:a aac -ar 48000 -b:a 128k -ac 2 %AUDIOFILTER% -c:v libx264 -vf yadif,scale=-2:720 -b:v 2500k -profile:v baseline -preset veryfast -tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1',
    );
    assert.deepEqual(candidates.slice(0, 2).map(preset => preset.id), ['manual-live', 'generated-live']);
});

// cmd を省略したプリセットの自動生成コマンドは、音声トラック切り替えのプレースホルダを
// 持っていないと副音声を選べない (AudioTrackUtil が展開する対象が無くなるため)
test('cmd 省略プリセットの生成コマンドは音声トラックのプレースホルダを持つ', () => {
    const configuration = {
        stream: {
            profiles: {
                live: [
                    {
                        id: 'generated-m2tsll',
                        name: '1080p',
                        container: 'm2tsll',
                        video: { codec: 'libx264', height: 1080, bitrate: 3000 },
                        audio: { codec: 'aac', bitrate: 192 },
                    },
                    {
                        id: 'generated-m2ts',
                        name: '720p',
                        container: 'm2ts',
                        video: { codec: 'libx264', height: 720, bitrate: 3000 },
                        audio: { codec: 'aac', bitrate: 192 },
                    },
                ],
            },
        },
    };
    const profiles = new StreamProfileManageModel({ getConfig: () => configuration }).getLiveProfiles();

    for (const profile of profiles) {
        assert.match(profile.cmd, /%DUALMONOMODE%/u);
        assert.match(profile.cmd, /%AUDIOFILTER%/u);
        assert.doesNotMatch(profile.cmd, /-dual_mono_mode (main|sub)/u);
    }

    // -map 0 で全 ES を通す m2tsll に %AUDIOMAP% を入れると ES が二重に出力される
    assert.doesNotMatch(profiles[0].cmd, /%AUDIOMAP%/u);
    assert.match(profiles[1].cmd, /%AUDIOMAP%/u);
});

// config の tsreadex を設定した場合、cmd 省略プリセットの前段へ tsreadex が入る。
// tsreadex はデュアルモノラルを 2 本の音声 ES へ分離するため、副音声の選び方も変わる
test('config に tsreadex を設定すると生成コマンドの前段へ tsreadex が入る', () => {
    const configuration = {
        tsreadex: '/usr/local/bin/tsreadex',
        stream: {
            profiles: {
                live: [
                    {
                        id: 'generated-m2tsll',
                        name: '1080p',
                        container: 'm2tsll',
                        video: { codec: 'libx264', height: 1080, bitrate: 3000 },
                        audio: { codec: 'aac', bitrate: 192 },
                    },
                ],
                recorded: {
                    encoded: [
                        {
                            id: 'generated-encoded',
                            name: '720p',
                            container: 'mp4',
                            video: { codec: 'libx264', height: 720, bitrate: 2000 },
                            audio: { codec: 'aac', bitrate: 128 },
                        },
                    ],
                },
            },
        },
    };
    const model = new StreamProfileManageModel({ getConfig: () => configuration });
    const live = model.getLiveProfiles()[0].cmd;

    assert.match(live, /^%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 - \| %FFMPEG%/u);
    // 第 2 音声が無いときに無音を挿入する -b 5 は使わない (副音声が完全な無音になる)
    assert.doesNotMatch(live, /-b 5/u);
    // 分離済みの音声 ES を選ぶため、-map 0 ではなく %AUDIOMAP% + optional map になる
    assert.match(live, /%AUDIOMAP% -map "0:s\?" -map "0:d\?"/u);
    assert.doesNotMatch(live, /-map 0 /u);

    // 録画ファイル入力は放送 TS ではないので tsreadex を通さない
    assert.doesNotMatch(model.getRecordedProfiles('encoded')[0].cmd, /%TSREADEX%/u);
});

test('config に tsreadex が無ければ生成コマンドは従来どおり -map 0 のまま', () => {
    const configuration = {
        stream: {
            profiles: {
                live: [
                    {
                        id: 'generated-m2tsll',
                        name: '1080p',
                        container: 'm2tsll',
                        video: { codec: 'libx264', height: 1080, bitrate: 3000 },
                        audio: { codec: 'aac', bitrate: 192 },
                    },
                ],
            },
        },
    };
    const cmd = new StreamProfileManageModel({ getConfig: () => configuration }).getLiveProfiles()[0].cmd;

    assert.doesNotMatch(cmd, /%TSREADEX%/u);
    assert.match(cmd, /-map 0 /u);
});
