'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    classifyOriginalHevcAudioLayout,
    compareDecodedAudio,
    createOriginalHevcHlsCommand,
    isOriginalHevcSource,
    isDecodedDualMono,
    ORIGINAL_HEVC_PROFILE_ID,
} = require('../../dist/util/OriginalHevcUtil');
const { classifyOriginalVideoSource } = require('../../dist/util/OriginalVideoUtil');
const ProcessUtil = require('../../dist/util/ProcessUtil').default;

test('HEVC 無変換プロファイルは対象を MPEG-TS の HEVC へ限定する', () => {
    assert.equal(ORIGINAL_HEVC_PROFILE_ID, 'original-hevc');
    assert.equal(isOriginalHevcSource({ codec: 'hevc', transport: 'mpegts' }), true);
    assert.equal(isOriginalHevcSource({ codec: 'mpeg2', transport: 'mpegts' }), false);
    assert.equal(isOriginalHevcSource({ codec: 'hevc', transport: 'mp4' }), false);
});

test('直接配信可能な Original source は MPEG-2 / HEVC MPEG-TS だけに分類する', () => {
    assert.equal(classifyOriginalVideoSource({ codec: 'mpeg2', transport: 'mpegts' }), 'mpeg2');
    assert.equal(classifyOriginalVideoSource({ codec: 'hevc', transport: 'mpegts' }), 'hevc');
    assert.equal(classifyOriginalVideoSource({ codec: 'hevc', transport: 'mp4' }), undefined);
    assert.equal(classifyOriginalVideoSource({ codec: 'h264', transport: 'mpegts' }), undefined);
});

test('main/sub の PCM が同一なら通常ステレオ、異なればデュアルモノラルと判定する', () => {
    const stereo = Buffer.from([0, 0, 10, 0, 20, 0, 30, 0]);
    const dualMono = Buffer.from([0, 0, 10, 0, 20, 0, 30, 0]);
    dualMono.writeInt16LE(1000, 0);

    assert.equal(isDecodedDualMono(compareDecodedAudio(stereo, stereo)), false);
    assert.equal(isDecodedDualMono(compareDecodedAudio(stereo, dualMono)), true);
    assert.equal(compareDecodedAudio(Buffer.alloc(0), Buffer.alloc(0)), undefined);
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

test('encoded HEVC の音声 ES 構成を dual-mono / multi / single に分類する', () => {
    assert.equal(
        classifyOriginalHevcAudioLayout([
            { streamIndex: 0, isDualMono: true },
            { streamIndex: 0, isDualMono: true },
        ]),
        'dual-mono',
    );
    assert.equal(
        classifyOriginalHevcAudioLayout([
            { streamIndex: 0, isDualMono: false },
            { streamIndex: 1, isDualMono: false },
        ]),
        'multi',
    );
    assert.equal(classifyOriginalHevcAudioLayout([{ streamIndex: 0, isDualMono: false }]), 'single');
    assert.equal(classifyOriginalHevcAudioLayout([]), undefined);
});

test('dual-mono encoded HEVC は filter_complex で主音声・副音声へ分離する', () => {
    const cmd = createOriginalHevcHlsCommand(false, 'file', 'dual-mono', 'all', 1);

    assert.match(cmd, /-filter_complex "\[0:a:0\]asplit=2\[m\]\[s\]/u);
    assert.match(cmd, /-map 0:v:0 -map "\[main_audio\]" -map "\[sub_audio\]"/u);
    assert.doesNotMatch(cmd, /%AUDIOFILTER%| -af /u);
    assert.equal(ProcessUtil.hasShellPipeline(cmd), false);
});

test('音声 ES 2 本の encoded HEVC は audio0 / audio1 を同時に AAC 化する', () => {
    const cmd = createOriginalHevcHlsCommand(false, 'file', 'multi', 'all', 1);

    assert.match(cmd, /-map 0:v:0 -map 0:a:0 -map 0:a:1/u);
    assert.match(cmd, /-c:a aac/u);
    assert.doesNotMatch(cmd, /-filter_complex|%AUDIOFILTER%/u);
    assert.equal(ProcessUtil.hasShellPipeline(cmd), false);
});

test('単一音声の encoded HEVC は従来どおり音声 1 本だけ出す', () => {
    const cmd = createOriginalHevcHlsCommand(false, 'file', 'single', 'all', 1);

    assert.match(cmd, /-map 0:v:0 -map 0:a:0\?/u);
    assert.doesNotMatch(cmd, /-map 0:a:1|-filter_complex|%AUDIOFILTER%/u);
    assert.equal(ProcessUtil.hasShellPipeline(cmd), false);
});

test('音声 ES 2 本の同時配信は 2 本目を optional map にする (途中で ES が消える録画で出力を開けなくならない)', () => {
    const { createOriginalHevcHlsCommand } = require('../../dist/util/OriginalHevcUtil');
    const cmd = createOriginalHevcHlsCommand(false, 'file', 'multi', 'all');
    assert.match(cmd, /-map 0:v:0 -map 0:a:0 -map 0:a:1\?/u);
});
