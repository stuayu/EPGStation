'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { toSourceCapabilities } = require('../../dist/util/SourceCapabilityUtil');
const { classifySource } = require('../../dist/util/SourceClassUtil');
const {
    shouldDeinterlace,
    replaceDeinterlacePlaceholder,
    toDeinterlaceInput,
} = require('../../dist/util/DeinterlaceUtil');

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

test('field_order unknown でも HEVC 59.94fps の progressive 素材は yadif を付けない', () => {
    assert.equal(
        shouldDeinterlace({
            codec: 'hevc',
            field_order: 'unknown',
            fps: '60000/1001',
            container: 'mpegts',
        }),
        false,
    );
});

test('fps の小数表記も progressive 判定へ使う', () => {
    assert.equal(
        shouldDeinterlace({ codec: 'hevc', field_order: 'unknown', fps: '59.94', container: 'mp4' }),
        false,
    );
});

test('MPEG-2 1080i は field_order と fps から yadif を付ける', () => {
    assert.equal(
        shouldDeinterlace({
            codec: 'mpeg2video',
            field_order: 'tt',
            fps: '30000/1001',
            container: 'mpegts',
        }),
        true,
    );
});

test('判定不能な入力は放送波を壊さないよう yadif 有りに倒す', () => {
    assert.equal(shouldDeinterlace({ codec: 'unknown', field_order: 'unknown', container: 'mpegts' }), true);
});

test('自動生成 cmd は progressive 素材で yadif を除去する', () => {
    const cmd = replaceDeinterlacePlaceholder('ffmpeg -vf %DEINTERLACE%,scale=-2:720 -f mpegts', {
        codec: 'hevc',
        field_order: 'unknown',
        fps: '60000/1001',
        container: 'mpegts',
    });

    assert.equal(cmd, 'ffmpeg -vf scale=-2:720 -f mpegts');
});

test('自動生成 cmd は 1080i 素材で yadif を残す', () => {
    const cmd = replaceDeinterlacePlaceholder('ffmpeg -vf %DEINTERLACE%,scale=-2:720 -f mpegts', {
        codec: 'mpeg2',
        field_order: 'tff',
        fps: '30000/1001',
        container: 'mpegts',
    });

    assert.equal(cmd, 'ffmpeg -vf yadif,scale=-2:720 -f mpegts');
});

test('手書き cmd はデインターレース用プレースホルダが無ければ変更しない', () => {
    const cmd = 'ffmpeg -vf yadif,scale=-2:720 -f mpegts';
    assert.equal(
        replaceDeinterlacePlaceholder(cmd, {
            codec: 'hevc',
            field_order: 'progressive',
            fps: 59.94,
            container: 'mpegts',
        }),
        cmd,
    );
});

test('SourceCapabilities の progressive は判定入力へ明示変換する', () => {
    assert.deepEqual(
        toDeinterlaceInput({
            codec: 'hevc',
            scan: 'progressive',
            frameRate: 59.94,
            transport: 'mpegts',
            hdr: 'sdr',
            sourceClass: 'generic',
            confidence: 'high',
        }),
        { codec: 'hevc', field_order: 'progressive', fps: 59.94, container: 'mpegts' },
    );
});
