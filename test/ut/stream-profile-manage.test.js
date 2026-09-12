'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const StreamProfileManageModel = require('../../dist/model/stream/StreamProfileManageModel').default;

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
