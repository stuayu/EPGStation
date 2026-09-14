'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { Transform } = require('node:stream');
const Fmp4Packager = require('../../../dist/model/service/stream/llhls/Fmp4Packager').default;
const OfflineFmp4RecordStream = require('../../../dist/model/service/stream/llhls/OfflineFmp4RecordStream').default;
const OfflineStreamParser = require('../../../dist/util/OfflineStreamParser').default;
const { getOfflineStreamMagic } = require('../../../dist/util/OfflineStreamProtocol');
const AribSubtitleTimedMetadataTransform = require('../../../dist/model/service/stream/llhls/AribSubtitleTimedMetadataTransform').default;
const AribId3Extractor = require('../../../dist/model/service/stream/llhls/AribId3Extractor').default;
const { createRecordedSubtitleReaderArgs } = require('../../../dist/util/RecordedSubtitleUtil');
const { result } = require('./output');

class DelayedEndTransform extends Transform {
    constructor(waitForEnd) {
        super();
        this.waitForEnd = waitForEnd;
    }

    _transform(chunk, _encoding, callback) {
        callback(null, chunk);
    }

    _flush(callback) {
        this.waitForEnd.then(() => callback(), callback);
    }
}

const spawnExit = child => new Promise(resolve => {
    const done = code => resolve(code ?? -1);
    child.once('close', done);
    child.once('error', () => done(-1));
});

const walkBoxes = (buffer, callback, start = 0, end = buffer.length) => {
    let offset = start;
    while (offset + 8 <= end) {
        const size = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const header = size === 1 ? 16 : 8;
        const boxEnd = size === 0 ? end : offset + size;
        if (boxEnd > end || boxEnd <= offset + header) return;
        callback(type, buffer.subarray(offset, boxEnd), offset);
        if (type === 'moof' || type === 'traf') walkBoxes(buffer, callback, offset + header, boxEnd);
        offset = boxEnd;
    }
};

const readTiming = segment => {
    const emsgs = [];
    let videoTfdt = null;
    const videoSamples = [];
    walkBoxes(segment, (type, box) => {
        if (type === 'emsg') {
            const version = box.readUInt8(8);
            if (version === 1 && box.length >= 32) {
                emsgs.push({
                    timescale: box.readUInt32BE(12),
                    presentationTime: Number(box.readBigUInt64BE(16)),
                });
            }
        } else if (type === 'traf') {
            let trackId = null;
            let tfdt = null;
            let timescale = 90000;
            let defaultDuration = 0;
            let trun = null;
            walkBoxes(box, (childType, child) => {
                if (childType === 'tfhd' && child.length >= 16) {
                    const flags = child.readUIntBE(9, 3);
                    trackId = child.readUInt32BE(12);
                    let offset = 16;
                    if ((flags & 0x000001) !== 0) offset += 8;
                    if ((flags & 0x000002) !== 0) offset += 4;
                    if ((flags & 0x000008) !== 0 && child.length >= offset + 4) defaultDuration = child.readUInt32BE(offset);
                } else if (childType === 'tfdt') {
                    const version = child.readUInt8(8);
                    tfdt = version === 1 ? Number(child.readBigUInt64BE(12)) : child.readUInt32BE(12);
                } else if (childType === 'trun') {
                    trun = child;
                }
            });
            if (trackId !== 1 || tfdt === null || trun === null) return;
            const flags = trun.readUIntBE(9, 3);
            const version = trun.readUInt8(8);
            const count = trun.readUInt32BE(12);
            let offset = 16;
            if ((flags & 0x000001) !== 0) offset += 4;
            if ((flags & 0x000004) !== 0) offset += 4;
            let timestamp = tfdt;
            for (let i = 0; i < count && offset + 4 <= trun.length; i++) {
                const duration = (flags & 0x000100) !== 0 ? trun.readUInt32BE(offset) : defaultDuration;
                if ((flags & 0x000100) !== 0) offset += 4;
                if ((flags & 0x000200) !== 0) offset += 4;
                if ((flags & 0x000400) !== 0) offset += 4;
                let compositionOffset = 0;
                if ((flags & 0x000800) !== 0) {
                    compositionOffset = version === 1 ? trun.readInt32BE(offset) : trun.readUInt32BE(offset);
                    offset += 4;
                }
                videoSamples.push((timestamp + compositionOffset) / timescale);
                timestamp += duration;
            }
            if (videoTfdt === null) videoTfdt = tfdt;
        }
    });
    return { emsgs, videoTfdt, videoSamples };
};

const probeInput = input => JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration,size,bit_rate', '-show_entries',
    'stream=start_time', '-select_streams', 'v:0', '-of', 'json', input], { encoding: 'utf8' }));

const probeSeekStart = async (input, seek, baseVideoStart) => {
    const encoder = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-copyts', '-ss', String(seek), '-i', input,
        '-map', '0:v:0', '-c:v', 'copy', '-to', String(baseVideoStart + seek + 5), '-f', 'mpegts', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const ffprobe = spawn('ffprobe', [
        '-v', 'error', '-f', 'mpegts', '-select_streams', 'v:0',
        '-show_packets', '-show_entries', 'packet=pts_time', '-of', 'json', 'pipe:0',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    ffprobe.stdout.on('data', chunk => { output += chunk; });
    encoder.stdout.pipe(ffprobe.stdin);
    await Promise.all([spawnExit(encoder), spawnExit(ffprobe)]);
    const first = JSON.parse(output).packets?.[0]?.pts_time;
    if (first === undefined) return null;
    return Number(first) - baseVideoStart;
};

const runOriginalHevc = async options => {
    const input = options.inputTs;
    if (typeof input !== 'string') return result('original-hevc', false, {}, '--input-ts が必要');
    const seek = Number.isFinite(options.seekSeconds) ? Math.max(0, options.seekSeconds) : 0;
    const probe = probeInput(input);
    const duration = Number(probe.format?.duration ?? 0);
    const baseVideoStart = Number(probe.streams?.[0]?.start_time ?? 0);
    const actualStartBeforeMain = await probeSeekStart(input, seek, baseVideoStart);
    const subtitleSeek = actualStartBeforeMain === null ? seek : actualStartBeforeMain;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-original-hevc-'));
    const firstOutput = path.join(directory, 'first-fragment.mp4');
    const mainArgs = [
        '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-ss', String(seek), '-i', input,
        '-sn', '-threads', '0', '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-tag:v', 'hvc1',
        '-c:a', 'copy', '-avoid_negative_ts', 'make_zero',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
    ];
    const main = spawn('ffmpeg', mainArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
    const packager = new Fmp4Packager({ partsPerSegment: 2, mode: 'recorded' }, null);
    const finished = once(packager, 'finish');
    let init = null;
    let firstSegment = null;
    let segmentCount = 0;
    let emsgCount = 0;
    let offlineSegmentCount = 0;
    let offlineRecordEmsgCount = 0;
    const timingDiffs = [];
    packager.on('init', data => { init = data; });
    packager.on('segment', segment => {
        segmentCount += 1;
        if (firstSegment === null) firstSegment = segment.data;
        const timing = readTiming(segment.data);
        emsgCount += timing.emsgs.length;
        if (timing.videoSamples.length > 0) {
            for (const emsg of timing.emsgs) {
                const emsgSeconds = emsg.presentationTime / emsg.timescale;
                timingDiffs.push(Math.min(...timing.videoSamples.map(sample => Math.abs(emsgSeconds - sample))));
            }
        }
    });

    let subtitleCount = 0;
    let subtitleProcess = null;
    let subtitleDone = Promise.resolve();
    if (options.withoutSubtitles !== true) {
        subtitleProcess = spawn('ffmpeg', createRecordedSubtitleReaderArgs(input, subtitleSeek), { stdio: ['ignore', 'pipe', 'ignore'] });
        subtitleDone = spawnExit(subtitleProcess).then(() => undefined);
        const transform = new AribSubtitleTimedMetadataTransform();
        const extractor = new AribId3Extractor(null);
        extractor.on('id3', metadata => {
            subtitleCount += 1;
            packager.pushId3(metadata, true);
        });
        extractor.resume();
        subtitleProcess.stdout.pipe(transform).pipe(extractor);
    }

    const startedAt = process.hrtime.bigint();
    let offlineRead = Promise.resolve();
    if (options.offline === true) {
        const source = subtitleProcess === null ? main.stdout : main.stdout.pipe(new DelayedEndTransform(subtitleDone));
        const offline = new OfflineFmp4RecordStream(source, packager);
        const parser = new OfflineStreamParser();
        const metadata = {
            videoFileId: 0,
            fileSize: Number(probe.format?.size ?? 0),
            duration,
            profile: 'original-hevc-measurement',
            formatVersion: 2,
        };
        const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
        const metadataLength = Buffer.alloc(4);
        metadataLength.writeUInt32BE(metadataBytes.length, 0);
        parser.push(Buffer.concat([getOfflineStreamMagic(), metadataLength, metadataBytes]));
        offlineRead = (async () => {
            for await (const record of offline) {
                for (const event of parser.push(record)) {
                    if (event.type === 'segment') {
                        offlineSegmentCount += 1;
                        const timing = readTiming(event.segment.data);
                        offlineRecordEmsgCount += timing.emsgs.length;
                    }
                }
            }
            parser.finish();
        })();
    } else if (subtitleProcess === null) {
        main.stdout.pipe(packager);
    } else {
        main.stdout.pipe(new DelayedEndTransform(subtitleDone)).pipe(packager);
    }
    const [mainCode] = await Promise.all([spawnExit(main), finished, offlineRead]);
    await subtitleDone;
    if (init !== null && firstSegment !== null) await fs.writeFile(firstOutput, Buffer.concat([init, firstSegment]));
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    let outputProbe = {};
    if (init !== null && firstSegment !== null) {
        try {
            outputProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile,codec_tag_string,width,height', '-of', 'json', firstOutput], { encoding: 'utf8' }));
        } catch (_error) {
            outputProbe = {};
        }
    }
    const video = outputProbe.streams?.find(stream => stream.codec_name === 'hevc') ?? {};
    const actualStart = actualStartBeforeMain;
    const sortedDiffs = timingDiffs.slice().sort((a, b) => a - b);
    const median = sortedDiffs.length === 0 ? null : sortedDiffs[Math.floor(sortedDiffs.length / 2)];
    const metrics = {
        input,
        seekRequestedSeconds: seek,
        actualStartSeconds: actualStart === null ? null : Number(actualStart.toFixed(3)),
        seekOffsetSeconds: actualStart === null ? null : Number((actualStart - seek).toFixed(3)),
        durationSeconds: duration,
        elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
        speed: Number(((duration - seek) / elapsedSeconds).toFixed(2)),
        mainExitCode: mainCode,
        segmentCount,
        subtitleReaderCount: subtitleCount,
        emsgCount,
        offlineSegmentCount: options.offline === true ? offlineSegmentCount : null,
        offlineRecordEmsgCount: options.offline === true ? offlineRecordEmsgCount : null,
        emsgVideoTimeDiffSeconds: {
            max: timingDiffs.length === 0 ? null : Number(Math.max(...timingDiffs).toFixed(3)),
            median: median === null ? null : Number(median.toFixed(3)),
        },
        ffprobe: {
            codec: video.codec_name ?? null,
            profile: video.profile ?? null,
            tag: video.codec_tag_string ?? null,
            width: video.width ?? null,
            height: video.height ?? null,
        },
        baseline: options.withoutSubtitles === true,
    };
    const valid = mainCode === 0 && segmentCount >= 3 && video.codec_name === 'hevc' && video.codec_tag_string === 'hvc1' && video.width === 1440 && video.height === 1080 && (options.withoutSubtitles === true || (subtitleCount > 0 && emsgCount > 0)) && (options.offline !== true || offlineSegmentCount > 0 && offlineRecordEmsgCount > 0);
    return result('original-hevc', valid, metrics, valid ? null : 'HEVC fMP4 または字幕 emsg 条件不成立');
};

module.exports = runOriginalHevc;
