'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const EncodePresets = require('../../dist/util/EncodePresets').default;

test('undefined presets produce nothing (feature flag off / not configured)', () => {
    const expansion = EncodePresets.expand(undefined);
    assert.deepEqual(expansion, { encode: [], live: [], recordedTs: [], recordedEncoded: [] });
});

test('defaults expand to software h264 at 1080p/720p/480p for all targets', () => {
    const expansion = EncodePresets.expand({});

    // encode (recorded target): 3 qualities x 1 codec x 1 hwaccel
    assert.equal(expansion.encode.length, 3);
    assert.equal(expansion.live.length, 3);
    // recordedStreaming: mp4 + hls per quality
    assert.equal(expansion.recordedTs.length, 6);
    assert.equal(expansion.recordedEncoded.length, 6);

    const encode1080 = expansion.encode.find(e => e.id === 'preset-encode-software-h264-1080p');
    assert.ok(encode1080, 'encode preset for 1080p software h264 should exist');
    assert.equal(encode1080.cmd, '%NODE% %ROOT%/config/enc.js h264 1080');
    assert.equal(encode1080.suffix, '.mp4');
    assert.equal(encode1080.rate, 10.0);
    assert.equal(encode1080.video.codec, 'libx264');
    assert.equal(encode1080.video.height, 1080);
});

test('targets flag restricts generation to the requested sections', () => {
    const onlyRecorded = EncodePresets.expand({ targets: ['recorded'] });
    assert.ok(onlyRecorded.encode.length > 0);
    assert.equal(onlyRecorded.live.length, 0);
    assert.equal(onlyRecorded.recordedTs.length, 0);
    assert.equal(onlyRecorded.recordedEncoded.length, 0);

    const onlyLive = EncodePresets.expand({ targets: ['liveHLS'] });
    assert.equal(onlyLive.encode.length, 0);
    assert.ok(onlyLive.live.length > 0);
    assert.equal(onlyLive.recordedTs.length, 0);
});

test('qualities flag controls which heights are generated', () => {
    const expansion = EncodePresets.expand({ targets: ['liveHLS'], qualities: ['240p'] });
    assert.equal(expansion.live.length, 1);
    assert.equal(expansion.live[0].video.height, 240);
    assert.match(expansion.live[0].cmd, /scale=-2:240/);
});

test('codecs flag adds hevc-specific ffmpeg options (tag:v hvc1, x265-params)', () => {
    const expansion = EncodePresets.expand({ targets: ['liveHLS'], codecs: ['h264', 'hevc'], qualities: ['720p'] });
    assert.equal(expansion.live.length, 2);

    const h264 = expansion.live.find(p => p.id.includes('h264'));
    const hevc = expansion.live.find(p => p.id.includes('hevc'));
    assert.ok(h264 && hevc);
    assert.equal(h264.video.codec, 'libx264');
    assert.equal(hevc.video.codec, 'libx265');
    assert.match(hevc.cmd, /-tag:v hvc1/);
    assert.match(hevc.cmd, /x265-params scenecut=0:repeat-headers=1/);
    assert.doesNotMatch(h264.cmd, /-tag:v hvc1/);
});

test('liveHLS cmd never includes %streamFileDir% (stays in-memory per doc/streaming-refresh.md)', () => {
    const expansion = EncodePresets.expand({ targets: ['liveHLS'] });
    for (const profile of expansion.live) {
        assert.doesNotMatch(profile.cmd, /%streamFileDir%/);
        assert.match(profile.cmd, /pipe:1/);
        assert.match(profile.cmd, /%FFMPEG%/);
    }
});

test('recordedStreaming hls cmd uses disk-based %streamFileDir% segments (subtitle/full-length support)', () => {
    const expansion = EncodePresets.expand({ targets: ['recordedStreaming'], qualities: ['720p'] });
    const tsHls = expansion.recordedTs.find(p => p.container === 'hls');
    const encodedHls = expansion.recordedEncoded.find(p => p.container === 'hls');
    assert.ok(tsHls && encodedHls);
    assert.match(tsHls.cmd, /%streamFileDir%/);
    assert.match(tsHls.cmd, /-i pipe:0/);
    assert.match(encodedHls.cmd, /-ss %SS% -i %INPUT%/);
});

test('hwaccel qsv/vaapi/nvenc select the right ffmpeg encoder name and options', () => {
    const qsv = EncodePresets.expand({ hwaccel: 'qsv', targets: ['liveHLS'], qualities: ['1080p'] });
    assert.equal(qsv.live[0].video.codec, 'h264_qsv');
    assert.match(qsv.live[0].cmd, /format=nv12/);

    const vaapi = EncodePresets.expand({ hwaccel: 'vaapi', targets: ['liveHLS'], qualities: ['1080p'] });
    assert.equal(vaapi.live[0].video.codec, 'h264_vaapi');
    assert.match(vaapi.live[0].cmd, /-vaapi_device \/dev\/dri\/renderD128/);
    assert.match(vaapi.live[0].cmd, /hwupload/);

    const nvenc = EncodePresets.expand({ hwaccel: 'nvenc', targets: ['liveHLS'], qualities: ['1080p'] });
    assert.equal(nvenc.live[0].video.codec, 'h264_nvenc');
    assert.match(nvenc.live[0].cmd, /-rc cbr/);

    // 録画エンコード (config/enc.js 呼び出し) 側もハードウェアごとに正しいプリセットキーを渡す
    const nvencEncode = EncodePresets.expand({ hwaccel: 'nvenc', targets: ['recorded'], qualities: ['1080p'] });
    assert.equal(nvencEncode.encode[0].cmd, '%NODE% %ROOT%/config/enc.js h264_nvenc 1080');
    assert.equal(nvencEncode.encode[0].rate, 3.0);
});

test('applyToConfig does nothing when encodePresets is not set (opt-in, no behavior change)', () => {
    const config = { encode: [], stream: { profiles: {} } };
    EncodePresets.applyToConfig(config);
    assert.deepEqual(config, { encode: [], stream: { profiles: {} } });
});

test('applyToConfig fills empty encode/stream.profiles from the flags', () => {
    const config = { encode: [], encodePresets: { targets: ['recorded', 'liveHLS', 'recordedStreaming'] } };
    EncodePresets.applyToConfig(config);

    assert.ok(config.encode.length > 0);
    assert.ok(config.stream.profiles.live.length > 0);
    assert.ok(config.stream.profiles.recorded.ts.length > 0);
    assert.ok(config.stream.profiles.recorded.encoded.length > 0);
});

test('applyToConfig keeps a hand-written encode array untouched (manual wins)', () => {
    const manualEncode = [{ id: 'manual', name: 'manual', cmd: 'manual cmd' }];
    const config = { encode: manualEncode, encodePresets: { targets: ['recorded'] } };
    EncodePresets.applyToConfig(config);
    assert.deepEqual(config.encode, manualEncode);
});

test('applyToConfig keeps hand-written stream.profiles.live untouched, per-section (manual wins per section)', () => {
    const manualLive = [{ id: 'manual-live', name: 'manual', container: 'hls', cmd: 'manual cmd' }];
    const config = {
        encode: [],
        stream: { profiles: { live: manualLive } },
        encodePresets: { targets: ['recorded', 'liveHLS', 'recordedStreaming'] },
    };
    EncodePresets.applyToConfig(config);

    // live はそのまま、encode / recorded.ts / recorded.encoded は生成される (セクション単位の優先度)
    assert.deepEqual(config.stream.profiles.live, manualLive);
    assert.ok(config.encode.length > 0);
    assert.ok(config.stream.profiles.recorded.ts.length > 0);
});

test('applyToConfig does not override legacy stream.live.ts.* (old-format manual config also wins)', () => {
    const config = {
        encode: [],
        stream: { live: { ts: { m2ts: [{ name: '1080p', cmd: 'legacy cmd' }] } } },
        encodePresets: { targets: ['liveHLS'] },
    };
    EncodePresets.applyToConfig(config);

    // stream.profiles.live を新規生成すると StreamProfileManageModel が新形式を優先してしまい
    // legacy な stream.live.ts.* が無視されてしまうため、生成しない
    assert.equal(typeof config.stream.profiles?.live, 'undefined');
    // legacy 設定自体は手を付けずそのまま残る
    assert.deepEqual(config.stream.live.ts.m2ts, [{ name: '1080p', cmd: 'legacy cmd' }]);
});

test('hwaccel qsvencc/nvencc/vceencc pipe a rigaya encoder into %FFMPEG% and never touch %streamFileDir% for live', () => {
    for (const hwaccel of ['qsvencc', 'nvencc', 'vceencc']) {
        const expansion = EncodePresets.expand({ hwaccel, targets: ['liveHLS'], qualities: ['1080p'] });
        const cmd = expansion.live[0].cmd;

        assert.equal(expansion.live[0].video.codec, 'h264');
        assert.match(cmd, /--avhw/);
        assert.match(cmd, /--audio-copy/);
        assert.match(cmd, /\| %FFMPEG%/);
        assert.doesNotMatch(cmd, /%streamFileDir%/);
        assert.match(cmd, /-c:v copy/);
    }
});

test('rigaya cmd only uses options that actually exist in QSVEncC/NVEncC/VCEEncC', () => {
    for (const hwaccel of ['qsvencc', 'nvencc', 'vceencc']) {
        const expansion = EncodePresets.expand({ hwaccel, targets: ['liveHLS'], qualities: ['720p'] });
        const cmd = expansion.live[0].cmd;

        // コンテナ指定は --output-format (--format というオプションは存在しない)
        assert.match(cmd, /--output-format mpegts/);
        assert.doesNotMatch(cmd, /(^|\s)--format\s/);
        // --closed-gop は 3 ツールいずれにも存在しない
        assert.doesNotMatch(cmd, /--closed-gop/);
        // アスペクト比追従は負値指定 (preserve_aspect_ratio に input という値は無い)
        assert.match(cmd, /--output-res -2x720/);
        assert.doesNotMatch(cmd, /preserve_aspect_ratio/);
        // デインタレースは --interlace tff が前提。VCEEncC に --vpp-deinterlace は無い
        assert.match(cmd, /--interlace tff/);
        if (hwaccel === 'vceencc') {
            assert.match(cmd, /--vpp-yadif/);
            assert.doesNotMatch(cmd, /--vpp-deinterlace/);
            // --strict-gop も VCEEncC には無い
            assert.doesNotMatch(cmd, /--strict-gop/);
        } else {
            assert.match(cmd, /--vpp-deinterlace normal/);
            assert.match(cmd, /--strict-gop/);
        }
        // dual mono の主音声選択は remux 側の ffmpeg が担う
        assert.match(cmd, /-dual_mono_mode main/);
    }
});

test('rigaya encoded (progressive input) does not deinterlace or force the interlace flag', () => {
    const expansion = EncodePresets.expand({ hwaccel: 'nvencc', targets: ['recordedStreaming'], qualities: ['720p'] });
    const encodedMp4 = expansion.recordedEncoded.find(p => p.container === 'mp4');
    assert.doesNotMatch(encodedMp4.cmd, /--vpp-deinterlace|--vpp-yadif|--interlace/);
});

test('unknown encodePresets values fall back to defaults instead of throwing', () => {
    const bogus = EncodePresets.expand({
        hwaccel: 'typo',
        codecs: ['h264', 'av1'],
        qualities: ['720p', '4320p'],
        targets: ['liveHLS', 'nowhere'],
    });

    // hwaccel は software 扱い、未知の codec / quality / target は無視される
    assert.equal(bogus.live.length, 1);
    assert.equal(bogus.live[0].video.codec, 'libx264');
    assert.equal(bogus.live[0].video.height, 720);
    assert.equal(bogus.encode.length, 0);
    assert.equal(bogus.recordedTs.length, 0);

    // すべて無効な場合は既定値 (h264 × 1080p/720p/480p × 全用途)
    const allBogus = EncodePresets.expand({ codecs: ['av1'], qualities: ['4320p'], targets: ['nowhere'] });
    assert.equal(allBogus.encode.length, 3);
    assert.equal(allBogus.live.length, 3);
});

test('rigaya recorded (config/enc.js) preset key differs per hwaccel and is passed as the enc.js argument', () => {
    const qsvencc = EncodePresets.expand({ hwaccel: 'qsvencc', targets: ['recorded'], qualities: ['720p'] });
    assert.equal(qsvencc.encode[0].cmd, '%NODE% %ROOT%/config/enc.js qsvencc_h264 720');

    const nvencc = EncodePresets.expand({
        hwaccel: 'nvencc',
        codecs: ['hevc'],
        targets: ['recorded'],
        qualities: ['720p'],
    });
    assert.equal(nvencc.encode[0].cmd, '%NODE% %ROOT%/config/enc.js nvencc_hevc 720');

    const vceencc = EncodePresets.expand({ hwaccel: 'vceencc', targets: ['recorded'], qualities: ['720p'] });
    assert.equal(vceencc.encode[0].cmd, '%NODE% %ROOT%/config/enc.js vceencc_h264 720');
});

test('rigaya recordedStreaming (encoded/file input) uses --seek %SS% -i %INPUT% instead of pipe input', () => {
    const expansion = EncodePresets.expand({ hwaccel: 'nvencc', targets: ['recordedStreaming'], qualities: ['720p'] });
    const encodedMp4 = expansion.recordedEncoded.find(p => p.container === 'mp4');
    const tsMp4 = expansion.recordedTs.find(p => p.container === 'mp4');

    assert.ok(encodedMp4 && tsMp4);
    assert.match(encodedMp4.cmd, /--seek %SS% -i %INPUT%/);
    assert.match(tsMp4.cmd, /-i - --input-format mpegts/);
});

test('rigaya exec path is configurable via execPaths and defaults to the bare command name on PATH', () => {
    const withCustomPath = EncodePresets.expand({ hwaccel: 'qsvencc', targets: ['liveHLS'], qualities: ['1080p'] }, {
        qsvencc: '/opt/rigaya/QSVEncC',
    });
    assert.match(withCustomPath.live[0].cmd, /^\/opt\/rigaya\/QSVEncC /);

    const withDefault = EncodePresets.expand({ hwaccel: 'qsvencc', targets: ['liveHLS'], qualities: ['1080p'] });
    assert.match(withDefault.live[0].cmd, /^QSVEncC /);
});

test('applyToConfig threads config.qsvencc/nvencc/vceencc into the generated rigaya cmd', () => {
    const config = {
        encode: [],
        qsvencc: '/usr/local/bin/QSVEncC',
        encodePresets: { hwaccel: 'qsvencc', targets: ['liveHLS'] },
    };
    EncodePresets.applyToConfig(config);
    assert.match(config.stream.profiles.live[0].cmd, /^\/usr\/local\/bin\/QSVEncC /);
});

test('ids are stable and unique across the whole expansion (client-facing profile ids must not collide)', () => {
    const expansion = EncodePresets.expand({ codecs: ['h264', 'hevc'], qualities: ['1080p', '720p', '480p', '240p'] });
    const allIds = [
        ...expansion.encode.map(e => e.id),
        ...expansion.live.map(e => e.id),
        ...expansion.recordedTs.map(e => e.id),
        ...expansion.recordedEncoded.map(e => e.id),
    ];
    assert.equal(new Set(allIds).size, allIds.length);
});
