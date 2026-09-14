'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createOriginalHevcHlsCommand,
    isOriginalHevcSource,
    ORIGINAL_HEVC_PROFILE_ID,
} = require('../../dist/util/OriginalHevcUtil');

test('HEVC 無変換プロファイルは対象を MPEG-TS の HEVC へ限定する', () => {
    assert.equal(ORIGINAL_HEVC_PROFILE_ID, 'original-hevc');
    assert.equal(isOriginalHevcSource({ codec: 'hevc', transport: 'mpegts' }), true);
    assert.equal(isOriginalHevcSource({ codec: 'mpeg2', transport: 'mpegts' }), false);
    assert.equal(isOriginalHevcSource({ codec: 'hevc', transport: 'mp4' }), false);
});

test('HEVC 無変換 HLS cmd は tsreadex・副音声・copy remux・hvc1 を含みデインターレースを残さない', () => {
    for (const useTsreadex of [false, true]) {
        const cmd = createOriginalHevcHlsCommand(useTsreadex);
        assert.match(cmd, /-c:v copy/u);
        assert.match(cmd, /-tag:v hvc1/u);
        // 放送 AAC の copy は Safari / WebKit で fMP4 のフラグメント境界で止まるため、音声は再エンコードする
        assert.doesNotMatch(cmd, /-c:a copy/u);
        assert.match(cmd, /-c:a aac /u);
        assert.match(cmd, /%AUDIOFILTER%/u);
        assert.match(cmd, /%DUALMONOMODE%/u);
        assert.match(cmd, /%AUDIOMAP%/u);
        assert.match(cmd, /-fflags \+genpts/u);
        assert.match(cmd, /-avoid_negative_ts make_zero/u);
        assert.doesNotMatch(cmd, /%DEINTERLACE%/u);
        assert.doesNotMatch(cmd, /-map 0/u);
        assert.equal(cmd.includes('%TSREADEX%'), useTsreadex);
    }
    assert.match(createOriginalHevcHlsCommand(false, 'file'), /-ss %SS% -i %INPUT%/u);
});
