'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
require('reflect-metadata');

const EncodePresets = require('../../dist/util/EncodePresets').default;
const StreamProfileManageModel = require('../../dist/model/stream/StreamProfileManageModel').default;

const templatePaths = [
    path.join(__dirname, '../../config/config.yml.template'),
    path.join(__dirname, '../../config/config-win.yml.template'),
];

const getTemplateProfiles = templatePath => {
    const config = yaml.load(fs.readFileSync(templatePath, 'utf8'));
    return [
        ...(config.stream?.profiles?.live ?? []),
        ...(config.stream?.profiles?.recorded?.ts ?? []),
        ...(config.stream?.profiles?.recorded?.encoded ?? []),
    ];
};

const h264Profiles = profiles => profiles.filter(profile => /-c:v\s+(?:libx264|h264_\w+)/u.test(profile.cmd ?? ''));

for (const templatePath of templatePaths) {
    test(`${path.basename(templatePath)} の H.264 配信cmdは10bit入力を8bitへ変換する`, () => {
        const profiles = h264Profiles(getTemplateProfiles(templatePath));

        assert.ok(profiles.length > 0);
        for (const profile of profiles) {
            assert.match(profile.cmd, /-pix_fmt yuv420p/u, profile.id);
        }
    });

    test(`${path.basename(templatePath)} の録画配信 cmd は音声トラック切り替えプレースホルダを持つ`, () => {
        const profiles = getTemplateProfiles(templatePath).filter(
            profile => profile.id?.startsWith('recorded-') && profile.cmd !== undefined,
        );

        assert.ok(profiles.length > 0);
        for (const profile of profiles) {
            assert.match(profile.cmd ?? '', /%DUALMONOMODE%/u, profile.id);
            assert.match(profile.cmd ?? '', /%AUDIOFILTER%/u, profile.id);
            if (profile.container === 'm2tsll') {
                assert.match(profile.cmd ?? '', /%AUDIOSELECTMAP%/u, profile.id);
            } else if (profile.cmd.includes('%AUDIOMAP%')) {
                assert.match(profile.cmd ?? '', /%AUDIOMAP%/u, profile.id);
            } else {
                assert.match(profile.cmd ?? '', /-map 0(?:\s|$)/u, profile.id);
            }
        }
    });
}

test('自動生成の H.264 配信cmdはエンコーダごとに8bit入力を処理する', () => {
    for (const hwaccel of ['software', 'qsv', 'vaapi', 'nvenc', 'qsvencc', 'nvencc', 'vceencc']) {
        const expansion = EncodePresets.expand({ hwaccel, targets: ['liveHLS', 'recordedStreaming'], qualities: ['720p'] });
        const profiles = [...expansion.live, ...expansion.recordedTs, ...expansion.recordedEncoded];

        assert.ok(profiles.length > 0, hwaccel);
        for (const profile of profiles) {
            if (hwaccel === 'software' || hwaccel === 'nvenc') {
                assert.match(profile.cmd, /-profile:v (?:high|main)[\s\S]*-pix_fmt yuv420p/u, `${hwaccel}:${profile.id}`);
            } else if (hwaccel === 'qsv' || hwaccel === 'vaapi') {
                assert.match(profile.cmd, /format=nv12/u, `${hwaccel}:${profile.id}`);
            } else {
                assert.match(profile.cmd, /--profile high --level 4\.0 --output-depth 8/u, `${hwaccel}:${profile.id}`);
            }
        }
    }
});

test('cmd省略時の H.264 は全コンテナで8bitへ変換し、HEVC出力の指定は上書きしない', () => {
    const model = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    live: ['m2ts', 'm2tsll', 'mp4', 'hls'].map(container => ({
                        id: `h264-${container}`,
                        name: container,
                        container,
                        video: { codec: 'libx264', height: 720 },
                        audio: { codec: 'aac', bitrate: 128 },
                    })),
                    recorded: { encoded: [] },
                },
            },
        }),
    });

    for (const profile of model.getLiveProfiles()) {
        assert.match(profile.cmd, /-c:v libx264[^\n]*-pix_fmt yuv420p/u, profile.id);
    }

    const hevcModel = new StreamProfileManageModel({
        getConfig: () => ({
            stream: {
                profiles: {
                    live: [{
                        id: 'hevc-hls',
                        name: 'HEVC',
                        container: 'hls',
                        video: { codec: 'libx265', height: 720 },
                        audio: { codec: 'aac', bitrate: 128 },
                    }],
                },
            },
        }),
    });
    assert.doesNotMatch(hevcModel.getLiveProfiles()[0].cmd, /-pix_fmt yuv420p/u);
});
