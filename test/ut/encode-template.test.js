'use strict';

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const template = fs.readFileSync(path.join(__dirname, '../../config/enc.js.template'), 'utf8');
const enhanceTemplate = fs.readFileSync(path.join(__dirname, '../../config/enc-enhance.js.template'), 'utf8');

const runTemplate = async ({ encoder = '', fieldOrder = 'progressive', colorTransfer = 'unknown', streamTransfer = 'bt709', colorPrimaries = 'bt709', firstExitCode = 0, filters = ' .S zscale V->V\n .S tonemap V->V\n' } = {}) => {
    const calls = [];
    const logs = [];
    const env = {
        INPUT: 'input.ts', OUTPUT: 'output.mp4', FFMPEG: 'ffmpeg', FFPROBE: 'ffprobe',
        VIDEORESOLUTION: '2160', AUDIOCOMPONENTTYPE: '0',
    };
    if (encoder) env.HWENCODER_H264 = encoder;
    const fakeProcess = {
        argv: ['node', 'enc.js', 'h264', '1080'],
        env,
        exitCode: undefined,
        on() {},
        exit(code) { this.exitCode = code; },
    };
    const childProcess = {
        execFile(_bin, args, callback) {
            if (args[0] === '-hide_banner') callback(null, filters, '');
            else callback(null, JSON.stringify({ streams: [{ field_order: fieldOrder, color_transfer: streamTransfer, color_primaries: colorPrimaries }], frames: [{ media_type: 'video', color_transfer: colorTransfer }] }), '');
        },
        spawn(bin, args) {
            calls.push({ bin, args });
            const child = new EventEmitter();
            child.stderr = new EventEmitter();
            child.stdout = new EventEmitter();
            child.kill = () => {};
            setImmediate(() => child.emit('close', calls.length === 1 ? firstExitCode : 0));
            return child;
        },
    };
    const context = {
        process: fakeProcess,
        console: { error(...args) { logs.push(args.join(' ')); }, log() {} },
        Promise,
        setImmediate,
        require(name) {
            assert.equal(name, 'child_process');
            return childProcess;
        },
    };
    vm.runInNewContext(template, context, { filename: 'enc.js.template' });
    await new Promise(resolve => setTimeout(resolve, 10));
    return { calls, exitCode: fakeProcess.exitCode, logs };
};

const runEnhanceTemplate = async ({ colorTransfer = 'bt709', streamTransfer = 'bt709', colorPrimaries = 'bt709', filters = ' .S zscale V->V\n .S tonemap V->V\n' } = {}) => {
    const calls = [];
    const logs = [];
    const fakeProcess = {
        env: { INPUT: 'input.ts', OUTPUT: 'output.mp4', FFMPEG: 'ffmpeg', FFPROBE: 'ffprobe', AUDIOCOMPONENTTYPE: '0' },
        exitCode: undefined,
        on() {},
    };
    const childProcess = {
        execFile(bin, args, callback) {
            if (bin === 'ffmpeg') return callback(null, filters, '');
            if (args.includes('-show_format')) return callback(null, JSON.stringify({ format: { duration: '10' } }), '');
            return callback(null, JSON.stringify({
                streams: [{ index: 0, field_order: 'progressive', color_transfer: streamTransfer, color_primaries: colorPrimaries }],
                frames: [{ media_type: 'video', stream_index: 0, color_transfer: colorTransfer }],
            }), '');
        },
        spawn(bin, args) {
            calls.push({ bin, args });
            const child = new EventEmitter();
            child.stderr = new EventEmitter();
            child.kill = () => {};
            setImmediate(() => child.emit('close', 0));
            return child;
        },
    };
    vm.runInNewContext(enhanceTemplate, {
        process: fakeProcess,
        console: { error(...args) { logs.push(args.join(' ')); }, log() {} },
        Promise,
        setImmediate,
        require(name) {
            assert.equal(name, 'child_process');
            return childProcess;
        },
    }, { filename: 'enc-enhance.js.template' });
    await new Promise(resolve => setTimeout(resolve, 10));
    return { calls, logs, exitCode: fakeProcess.exitCode };
};

test('enc.js.template は VUI BT.2020-10 に対する frame HLG を拾い、tone-map せず変換する', async () => {
    const { calls } = await runTemplate({ colorTransfer: 'arib-std-b67', streamTransfer: 'bt2020-10', colorPrimaries: 'bt2020' });
    const args = calls[0].args;
    const filterIndex = args.indexOf('-vf');

    assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.notEqual(filterIndex, -1);
    assert.match(args[filterIndex + 1], /scale=-2:1080,colorspace=all=bt709:iall=bt2020/u);
    assert.ok(args.includes('-color_primaries') && args.includes('bt709'));
    assert.doesNotMatch(args[filterIndex + 1], /yadif/u);
});

test('enc.js.template は BT.2020 SDR の frame transfer を colorspace の itrc に渡す', async () => {
    const { calls } = await runTemplate({ colorTransfer: 'bt709', streamTransfer: 'bt2020-10', colorPrimaries: 'bt2020' });
    const args = calls[0].args;
    const filter = args[args.indexOf('-vf') + 1];
    assert.match(filter, /colorspace=all=bt709:iall=bt2020:itrc=bt709/);
    assert.match(filter, /format=yuv420p/);
});

test('enc.js.template は QSV用NV12を指定し、HW失敗時にsoftwareへ再試行する', async () => {
    const { calls, exitCode } = await runTemplate({ encoder: 'h264_qsv', fieldOrder: 'tt', firstExitCode: 1 });

    assert.equal(exitCode, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args[calls[0].args.indexOf('-c:v') + 1], 'h264_qsv');
    assert.match(calls[0].args[calls[0].args.indexOf('-vf') + 1], /yadif.*format=nv12/u);
    assert.equal(calls[1].args[calls[1].args.indexOf('-c:v') + 1], 'libx264');
});

test('enc.js.template は rigaya capability alias を選択し、失敗時にsoftwareへ再試行する', async () => {
    const { calls, exitCode } = await runTemplate({ encoder: 'qsvencc_h264', firstExitCode: 1 });

    assert.equal(exitCode, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].bin, 'QSVEncC');
    assert.ok(calls[0].args.includes('--output-format'));
    assert.equal(calls[1].bin, 'ffmpeg');
    assert.equal(calls[1].args[calls[1].args.indexOf('-c:v') + 1], 'libx264');
    assert.equal(calls[0].args.includes('--vpp-deinterlace'), false);
    assert.equal(calls[0].args.includes('--interlace'), false);
});

test('enc.js.template は rigaya の8bit BT.2020出力で色変換を省略したとログに出す', async () => {
    const { calls, logs } = await runTemplate({
        encoder: 'qsvencc_h264', colorTransfer: 'bt2020-10', streamTransfer: 'bt2020-10', colorPrimaries: 'bt2020',
    });
    assert.equal(calls[0].bin, 'QSVEncC');
    assert.ok(logs.some(message => message.includes('color conversion skipped: rigaya path')));
});

test('enc.js.template はインターレース素材の rigaya にだけデインターレースを指定する', async () => {
    const { calls } = await runTemplate({ encoder: 'qsvencc_h264', fieldOrder: 'tt' });
    assert.ok(calls[0].args.includes('--interlace'));
    assert.ok(calls[0].args.includes('--vpp-deinterlace'));
});

test('enc.js.template の VideoToolbox は bitrateと8bit pixel formatを渡す', async () => {
    const { calls } = await runTemplate({ encoder: 'h264_videotoolbox' });
    const args = calls[0].args;

    assert.equal(args[args.indexOf('-c:v') + 1], 'h264_videotoolbox');
    assert.equal(args[args.indexOf('-b:v') + 1], '6M');
    assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');
    assert.equal(args[args.indexOf('-allow_sw') + 1], '0');
});

test('enc.js.template は PQ で zscale が無ければ互換色域変換へ落とす', async () => {
    const { calls } = await runTemplate({ colorTransfer: 'smpte2084', colorPrimaries: 'bt2020', filters: ' .S tonemap V->V\n' });

    assert.equal(calls[0].args.includes('-vf'), true);
    assert.match(calls[0].args[calls[0].args.indexOf('-vf') + 1], /colorspace=all=bt709:iall=bt2020/u);
    assert.ok(calls[0].args.includes('-color_primaries'));
});

test('enc-enhance.js.template は BT.2020 SDR の frame transfer で変換し、BT.709タグを付ける', async () => {
    const { calls } = await runEnhanceTemplate({ colorTransfer: 'bt709', streamTransfer: 'bt2020-10', colorPrimaries: 'bt2020' });
    const args = calls[0].args;
    const filter = args[args.indexOf('-vf') + 1];
    assert.match(filter, /colorspace=all=bt709:iall=bt2020:itrc=bt709/);
    assert.ok(args.includes('-color_primaries') && args.includes('bt709'));
});

test('enc-enhance.js.template は frame HLG を SDR互換経路で処理し、PQ は zscale 不在時に互換経路へ落とす', async () => {
    const hlg = await runEnhanceTemplate({ colorTransfer: 'arib-std-b67', streamTransfer: 'bt2020-10', colorPrimaries: 'bt2020' });
    const hlgFilter = hlg.calls[0].args[hlg.calls[0].args.indexOf('-vf') + 1];
    assert.match(hlgFilter, /itrc=bt2020-10/);
    assert.doesNotMatch(hlgFilter, /zscale|tonemap/);

    const pq = await runEnhanceTemplate({ colorTransfer: 'smpte2084', colorPrimaries: 'bt2020', filters: ' .S tonemap V->V\n' });
    const pqFilter = pq.calls[0].args[pq.calls[0].args.indexOf('-vf') + 1];
    assert.match(pqFilter, /colorspace=all=bt709:iall=bt2020:itrc=bt2020-10/);
    assert.ok(pq.logs.some(message => message.includes('PQ compatible BT.2020-to-BT.709 path')));
});
