'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const HardwareEncoderDetector = require('../../dist/model/encoder/HardwareEncoderDetector').default;
const { getEncodeHardwarePreset } = require('../../dist/model/encoder/HardwareEncoderDetector');

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

test('実際に HEVC Main10 を復号できた HW デコーダーだけを 4K HEVC に返す', async () => {
    const { detector, calls } = makeDetector({}, (_command, args) => {
        if (args[1] === '-encoders') return { exitCode: 0, stdout: ' V.... libx265\n V..... hevc_videotoolbox', stderr: '' };
        if (args.includes('libx265')) return { exitCode: 0, stdout: '', stderr: '' };
        if (args.includes('-hwaccel')) return { exitCode: args[args.indexOf('-hwaccel') + 1] === 'videotoolbox' ? 0 : 1, stdout: '', stderr: '' };
        return missing();
    });
    await detector.detect();
    assert.equal(detector.getHardwareDecoder({ codec: 'hevc', height: 2160, bitDepth: 10 }), process.platform === 'darwin' ? 'videotoolbox' : undefined);
    assert.equal(detector.getHardwareDecoder({ codec: 'hevc', height: 1080, bitDepth: 10 }), undefined);
    assert.equal(detector.getHardwareDecoder({ codec: 'hevc', height: 2160, bitDepth: 8 }), undefined);
    assert.equal(calls.some(([, args]) => args.includes('-hwaccel') && args.includes('-f') && args.includes('null')), true);
});

test('ffmpeg の VideoToolbox 列挙を実測結果として返す', async () => {
    const { detector, calls } = makeDetector({}, (command, args) => {
        if (command === 'ffmpeg' && args[1] === '-encoders') {
            return { exitCode: 0, stdout: ' V..... h264_videotoolbox\n V..... hevc_videotoolbox', stderr: '' };
        }
        if (args.includes('-filters')) return { exitCode: 0, stdout: ' ... zscale\n ... tonemap', stderr: '' };
        if (args.includes('h264_videotoolbox')) return { exitCode: 0, stdout: '', stderr: '' };
        return missing();
    });
    const result = await detector.detect();
    assert.ok(result.available.includes('videotoolbox'));
    assert.equal(result.encoders.find(item => item.id === 'videotoolbox').provider, 'ffmpeg');
    assert.deepEqual(result.encoders.find(item => item.id === 'videotoolbox').codecs, ['h264']);
    assert.equal(calls.some(([, args]) => args.includes('hevc_videotoolbox') && args.includes('-allow_sw')), true);
});

test('ffmpeg は encoder 名が列挙されても試し変換失敗なら利用可能にしない', async () => {
    const { detector } = makeDetector({ hardwareEncoder: 'videotoolbox' }, (command, args) => {
        if (command === 'ffmpeg' && args[1] === '-encoders') return { exitCode: 0, stdout: ' V..... h264_videotoolbox', stderr: '' };
        if (args.includes('-filters')) return { exitCode: 0, stdout: ' ... zscale\n ... tonemap', stderr: '' };
        if (args.includes('h264_videotoolbox')) return { exitCode: 1, stdout: '', stderr: 'Cannot create compression session' };
        return missing();
    });
    const result = await detector.detect();
    assert.deepEqual(result.available, ['software']);
    assert.equal(result.selected, 'software');
});

test('ffmpeg QSV の試し変換は実配信と同じ scale + NV12 filter を使う', async () => {
    const { detector, calls } = makeDetector({}, (command, args) => {
        if (command === 'ffmpeg' && args[1] === '-encoders') return { exitCode: 0, stdout: ' V..... h264_qsv', stderr: '' };
        if (args.includes('h264_qsv')) return { exitCode: 0, stdout: '', stderr: '' };
        return missing();
    });
    await detector.detect();
    const probe = calls.find(([, args]) => args.includes('h264_qsv'))[1];
    assert.equal(probe[probe.indexOf('-vf') + 1], 'scale=160:120,format=nv12');
    assert.equal(probe.includes('-pix_fmt'), false);
});

test('録画後エンコード向け環境変数に ffmpeg / rigaya の選択結果を変換する', () => {
    assert.equal(getEncodeHardwarePreset({ kind: 'ffmpeg', codecs: ['h264'], bitDepths: [8], ffmpegCodecs: 'h264_videotoolbox' }, 'h264'), 'h264_videotoolbox');
    assert.equal(getEncodeHardwarePreset({ kind: 'qsvencc', codecs: ['h264'], bitDepths: [8] }, 'h264'), 'qsvencc_h264');
    assert.equal(getEncodeHardwarePreset({ kind: 'nvencc', codecs: ['hevc'], bitDepths: [8] }, 'hevc'), 'nvencc_hevc');
    assert.equal(getEncodeHardwarePreset({ kind: 'ffmpeg', codecs: ['h264'], bitDepths: [8] }, 'h264'), '');
});
