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

const getTemplateConfig = templatePath => yaml.load(fs.readFileSync(templatePath, 'utf8'));

const getTemplateProfiles = templatePath => {
    const config = getTemplateConfig(templatePath);
    return [
        ...(config.stream?.profiles?.live ?? []),
        ...(config.stream?.profiles?.recorded?.ts ?? []),
        ...(config.stream?.profiles?.recorded?.encoded ?? []),
    ];
};

const getGeneratedProfiles = templatePath => {
    const model = new StreamProfileManageModel({ getConfig: () => getTemplateConfig(templatePath) });
    return [...model.getLiveProfiles(), ...model.getRecordedProfiles('ts'), ...model.getRecordedProfiles('encoded')];
};

for (const templatePath of templatePaths) {
    test(`${path.basename(templatePath)} はエンコード・配信プロファイルを有効にしている`, () => {
        const config = getTemplateConfig(templatePath);
        assert.ok(config.encode?.length > 0, 'encode');
        assert.ok(config.stream?.profiles?.live?.length > 0, 'live');
        assert.ok(config.stream?.profiles?.recorded?.ts?.length > 0, 'recorded.ts');
        assert.ok(config.stream?.profiles?.recorded?.encoded?.length > 0, 'recorded.encoded');
        assert.equal(config.stream.profiles.live.length, 16, 'live count');
        assert.equal(config.stream.profiles.recorded.ts.length, 10, 'recorded.ts count');
        assert.equal(config.stream.profiles.recorded.encoded.length, 10, 'recorded.encoded count');
        assert.equal(config.encode.length, 1, 'encode count');
        assert.equal(getTemplateProfiles(templatePath).filter(profile => typeof profile.cmd === 'string').length, 0);
    });

    test(`${path.basename(templatePath)} の自動生成 H.264 配信cmdは10bit入力を8bitへ変換する`, () => {
        const profiles = getGeneratedProfiles(templatePath).filter(profile => /-c:v\s+libx264/u.test(profile.cmd ?? ''));

        assert.ok(profiles.length > 0);
        for (const profile of profiles) {
            assert.match(profile.cmd, /-pix_fmt yuv420p/u, profile.id);
            assert.match(profile.cmd, /%TONEMAP%/u, profile.id);
        }
    });

    test(`${path.basename(templatePath)} の 1080p HLS / M2TS-LL は自動 cmd を使う`, () => {
        const profiles = getGeneratedProfiles(templatePath);
        for (const id of ['live-hls-1080p-avc', 'live-m2tsll-1080p-avc']) {
            const profile = profiles.find(candidate => candidate.id === id);
            assert.ok(profile, id);
            assert.match(profile.cmd ?? '', /-pix_fmt yuv420p/u, id);
            assert.match(profile.cmd ?? '', /%DEINTERLACE%,scale=-2:1080,%TONEMAP%/u, id);
            if (id === 'live-hls-1080p-avc') assert.doesNotMatch(profile.cmd ?? '', /(?:^|\s)-re(?:\s|$)/u, id);
        }
    });

    test(`${path.basename(templatePath)} の録画配信 cmd は音声トラック切り替えプレースホルダを持つ`, () => {
        const profiles = getGeneratedProfiles(templatePath).filter(profile => profile.id?.startsWith('recorded-'));

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
        assert.ok(
            expansion.live
                .filter(profile => /(?:264|h264)/u.test(profile.video.codec))
                .filter(profile => !['qsvencc', 'nvencc', 'vceencc'].includes(hwaccel))
                .every(profile => /%TONEMAP%/u.test(profile.cmd)),
            `${hwaccel}: HLS tone-map placeholder`,
        );
        assert.ok(expansion.live.every(profile => !/-fflags nobuffer/u.test(profile.cmd)), `${hwaccel}: no startup frame loss`);
    }
});

test('cmd省略時の H.264 と HEVC Main8 は8bit色変換へ対応する', () => {
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
    assert.match(hevcModel.getLiveProfiles()[0].cmd, /-pix_fmt yuv420p/u);
    assert.match(hevcModel.getLiveProfiles()[0].cmd, /%TONEMAP%/u);
});
