'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const HardwareEncoderDetector = require('../../dist/model/encoder/HardwareEncoderDetector').default;

const logger = {
    system: { info: () => {}, warn: () => {} },
};

const makeDetector = (config, responses) => {
    const calls = [];
    const executor = {
        run: async (command, args) => {
            calls.push([command, args]);
            return responses(command, args);
        },
    };
    const detector = new HardwareEncoderDetector(
        { getConfig: () => ({ ffmpeg: 'ffmpeg', ...config }) },
        { getLogger: () => logger },
        executor,
    );
    return { detector, calls };
};

const missing = () => ({ exitCode: 1, stdout: '', stderr: '' });

test('QSVEncC の実測成功だけを QSV として採用する', async () => {
    const { detector, calls } = makeDetector({}, (command, args) => {
        if (command === 'ffmpeg')
            return { exitCode: 0, stdout: ' V..... h264 h264_qsv\n V..... hevc hevc_qsv', stderr: '' };
        if (command === 'QSVEncC' && args[0] === '--check-hw')
            return { exitCode: 0, stdout: 'Hardware Device: Intel', stderr: '' };
        return missing();
    });

    const result = await detector.detect();
    assert.equal(result.selected, 'qsv');
    assert.deepEqual(result.available, ['qsv', 'software']);
    assert.equal(detector.getStreamEncoder('h264').kind, 'qsvencc');
    assert.equal(calls.filter(call => call[1][0] === '--check-hw').length, 9);
    await detector.detect();
    assert.equal(calls.filter(call => call[1][0] === '--check-hw').length, 9);
});

test('利用可能なハードウェアが無い場合は software を選ぶ', async () => {
    const { detector } = makeDetector({}, () => missing());
    const result = await detector.detect();
    assert.deepEqual(result.available, ['software']);
    assert.equal(result.selected, 'software');
    assert.equal(detector.getStreamEncoder('hevc').ffmpegCodecs, undefined);
});

test('利用できない手動指定は warning 後に software へ倒す', async () => {
    const { detector } = makeDetector({ hardwareEncoder: 'nvenc' }, () => missing());
    const result = await detector.detect();
    assert.equal(result.configured, 'nvenc');
    assert.equal(result.selected, 'software');
});

test('ffmpeg の VideoToolbox 列挙を実測結果として返す', async () => {
    const { detector } = makeDetector({}, command => {
        if (command === 'ffmpeg') {
            return { exitCode: 0, stdout: ' V..... h264_videotoolbox\n V..... hevc_videotoolbox', stderr: '' };
        }
        return missing();
    });
    const result = await detector.detect();
    assert.ok(result.available.includes('videotoolbox'));
    assert.equal(result.encoders.find(item => item.id === 'videotoolbox').provider, 'ffmpeg');
});
