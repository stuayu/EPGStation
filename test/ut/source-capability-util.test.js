'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { toSourceCapabilities } = require('../../dist/util/SourceCapabilityUtil');
const { classifySource } = require('../../dist/util/SourceClassUtil');

test('BS4K 相当の ffprobe 情報を解析する', () => {
    const source = toSourceCapabilities({
        codec_name: 'hevc', width: 3840, height: 2160, pix_fmt: 'yuv420p10le',
        field_order: 'progressive', avg_frame_rate: '60000/1001',
        color_transfer: 'arib-std-b67', color_primaries: 'bt2020',
    });
    assert.equal(source.scan, 'progressive');
    assert.equal(source.bitDepth, 10);
    assert.equal(source.hdr, 'hlg');
    assert.ok(Math.abs(source.frameRate - 59.94005994) < 0.001);
    assert.equal(classifySource(source), 'bs4k');
});

test('1080i 地上波相当を解析する', () => {
    const source = toSourceCapabilities({
        codec_name: 'mpeg2video', width: 1440, height: 1080, pix_fmt: 'yuv420p',
        field_order: 'tt', avg_frame_rate: '30000/1001', color_primaries: 'bt709',
    });
    assert.equal(source.scan, 'interlaced');
    assert.equal(source.fieldOrder, 'tff');
    assert.equal(classifySource(source), 'legacy-broadcast');
});

test('field_order が無い入力を unknown とする', () => {
    assert.equal(toSourceCapabilities({ codec_name: 'mpeg2video' }).scan, 'unknown');
});

test('2160p SDR h264 は BS4K と断定しない', () => {
    const source = toSourceCapabilities({
        codec_name: 'h264', width: 3840, height: 2160, pix_fmt: 'yuv420p',
        field_order: 'progressive', color_transfer: 'bt709', color_primaries: 'bt709',
    });
    assert.notEqual(classifySource(source), 'bs4k');
});
