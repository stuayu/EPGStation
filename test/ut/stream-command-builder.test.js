'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const LiveCommandBuilder = require('../../dist/model/stream/builder/LiveCommandBuilder').default;
const RecordedCommandBuilder = require('../../dist/model/stream/builder/RecordedCommandBuilder').default;
const { getVideoCorrectionFilter } = require('../../dist/util/VideoCorrectionUtil');

const encoder = (kind, bitDepths = [8, 10], hdr = true) => ({
    kind,
    codecs: ['h264', 'hevc'],
    bitDepths,
    hdr,
});

const bs4k = {
    transport: 'mpegts',
    codec: 'hevc',
    width: 3840,
    height: 2160,
    bitDepth: 10,
    scan: 'progressive',
    frameRate: 59.94,
    fieldOrder: 'unknown',
    colorPrimaries: 'bt2020',
    transfer: 'hlg',
    hdr: 'hlg',
    sourceClass: 'bs4k',
    confidence: 'high',
};

const terrestrial1080i = {
    codec: 'mpeg2',
    width: 1920,
    height: 1080,
    bitDepth: 8,
    scan: 'interlaced',
    frameRate: 29.97,
    fieldOrder: 'tff',
    hdr: 'sdr',
    sourceClass: 'legacy-broadcast',
    confidence: 'high',
};

const preset = output => ({ id: 'test', name: 'test', useFor: 'both', quality: 'high', builtin: false, output });

test('BS4K progressive source never receives interlace or legacy 29.97 options', () => {
    const cmd = new RecordedCommandBuilder().build(
        bs4k,
        preset({ codec: 'hevc', resolution: '2160p', bitDepth: 10, frameRate: 'source', hdrMode: 'preserve' }),
        [encoder('nvencc')],
    );
    assert.doesNotMatch(cmd, /--interlace|--vpp-deinterlace|--vpp-yadif|yadif|30000\/1001/);
});

test('BS4K HDR preserve keeps Main10, 10-bit and HLG BT.2020 metadata', () => {
    const cmd = new LiveCommandBuilder().build(
        bs4k,
        preset({ codec: 'hevc', resolution: '2160p', bitDepth: 10, frameRate: 'source', hdrMode: 'preserve' }),
        [encoder('nvencc')],
    );
    assert.match(cmd, /main10/);
    assert.match(cmd, /output-depth 10/);
    assert.match(cmd, /bt2020/);
    assert.match(cmd, /arib-std-b67/);
});

test('BS4K tone-map converts HLG BT.2020 to 8-bit BT.709', () => {
    const cmd = new LiveCommandBuilder().build(
        bs4k,
        preset({ codec: 'h264', resolution: '1080p', bitDepth: 8, frameRate: 'source', hdrMode: 'tone-map' }),
        [encoder('ffmpeg', [8], false)],
    );
    assert.match(cmd, /zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709/);
    assert.match(cmd, /format=yuv420p/);
    assert.match(cmd, /-color_primaries bt709 -color_trc bt709 -colorspace bt709/);
});

test('BS4K preserve does not add tone mapping', () => {
    const cmd = new LiveCommandBuilder().build(
        bs4k,
        preset({ codec: 'hevc', resolution: '2160p', bitDepth: 10, hdrMode: 'preserve' }),
        [encoder('ffmpeg')],
    );
    assert.doesNotMatch(cmd, /zscale|tonemap|hdr2sdr/);
});

test('SDR source with tone-map does not add tone mapping', () => {
    const cmd = new LiveCommandBuilder().build(
        terrestrial1080i,
        preset({ codec: 'h264', resolution: '1080p', bitDepth: 8, hdrMode: 'tone-map' }),
        [encoder('ffmpeg', [8], false)],
    );
    assert.doesNotMatch(cmd, /zscale|tonemap|hdr2sdr/);
});

test('映像補正オフは補正フィルタを付けない', () => {
    assert.equal(getVideoCorrectionFilter(terrestrial1080i, 'off', { hdrMode: 'sdr' }), null);
});

test('映像補正autoはネイティブHDRを無条件に明るくしない', () => {
    assert.equal(getVideoCorrectionFilter(bs4k, 'auto', { hdrMode: 'preserve', clientHdr: true }), null);
});

test('1080i terrestrial source receives tff normal deinterlace', () => {
    const cmd = new LiveCommandBuilder().build(
        terrestrial1080i,
        preset({ codec: 'h264', resolution: '1080p', bitDepth: 8, frameRate: '30p', hdrMode: 'sdr' }),
        [encoder('nvencc', [8], false)],
    );
    assert.match(cmd, /--interlace tff/);
    assert.match(cmd, /--vpp-deinterlace normal/);
});

test('1080i 60p output uses bob and passes 60000/1001 for recorded file input', () => {
    const cmd = new RecordedCommandBuilder().build(
        terrestrial1080i,
        preset({
            codec: 'h264',
            resolution: '1080p',
            bitDepth: 8,
            frameRate: '60p',
            deinterlace: '60p',
            hdrMode: 'sdr',
        }),
        [encoder('qsvencc', [8], false)],
    );
    assert.match(cmd, /--vpp-deinterlace bob/);
    assert.match(cmd, /--fps 60000\/1001/);
});

test('Main10 requirement does not silently select an 8-bit-only encoder', () => {
    assert.throws(
        () =>
            new LiveCommandBuilder().build(
                bs4k,
                preset({ codec: 'hevc', resolution: '2160p', bitDepth: 10, hdrMode: 'preserve' }),
                [encoder('nvencc', [8], false)],
            ),
        /No available encoder/,
    );
});
