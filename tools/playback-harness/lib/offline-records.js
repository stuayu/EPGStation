'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { result } = require('./output');
const Fmp4Packager = require('../../../dist/model/service/stream/llhls/Fmp4Packager').default;
const OfflineFmp4RecordStream = require('../../../dist/model/service/stream/llhls/OfflineFmp4RecordStream').default;
const OfflineStreamParser = require('../../../dist/util/OfflineStreamParser').default;
const { getOfflineStreamMagic } = require('../../../dist/util/OfflineStreamProtocol');

const execFileAsync = promisify(require('node:child_process').execFile);
const run = (command, args, options = {}) =>
    new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
        child.once('error', reject);
        child.once('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exit=${code}`))));
    });

const probe = async file => {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
    return JSON.parse(stdout);
};

const writeChunk = async (file, chunk) => {
    if (file.write(chunk) === false) await once(file, 'drain');
};

const generateInput = async directory => {
    const file = path.join(directory, 'sample-mpeg2-1080i-aac.ts');
    await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=1440x1080:rate=30000/1001',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
        '-t', '60', '-map', '0:v:0', '-map', '1:a:0',
        '-vf', 'format=yuv420p', '-c:v', 'mpeg2video', '-b:v', '8M',
        '-flags', '+ildct+ilme', '-c:a', 'aac', '-b:a', '192k',
        '-f', 'mpegts', file,
    ]);
    return file;
};

const makeHevcInput = async (directory, input, nonIdrStart) => {
    const output = path.join(directory, 'sample-tsreplace-hevc.ts');
    await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx265', '-profile:v', 'main',
        '-pix_fmt', 'yuv420p', '-x265-params', 'repeat-headers=1:keyint=30:min-keyint=30:scenecut=0',
        '-c:a', 'copy', '-f', 'mpegts', output,
    ]);
    if (nonIdrStart === true) {
        const bytes = await fsp.readFile(output);
        await fsp.writeFile(output, bytes.subarray(Math.min(bytes.length - 188, 188 * 97)));
    }
    return output;
};

const metadataFrame = metadata => {
    const payload = Buffer.from(JSON.stringify(metadata), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length, 0);
    return Buffer.concat([length, payload]);
};

const appendJsonHeader = async (file, metadata) => {
    await writeChunk(file, getOfflineStreamMagic());
    await writeChunk(file, metadataFrame(metadata));
};

const buildLocalPlaylist = async (directory, role, durations) => {
    const targetDuration = Math.max(1, Math.ceil(Math.max(...durations)));
    const lines = [
        '#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-PLAYLIST-TYPE:VOD',
        `#EXT-X-TARGETDURATION:${targetDuration}`, '#EXT-X-MEDIA-SEQUENCE:0',
        `#EXT-X-MAP:URI="${role}-init.mp4"`,
    ];
    durations.forEach((duration, sequence) => {
        lines.push(`#EXTINF:${duration.toFixed(3)},`, `${role}-${sequence}.m4s`);
    });
    lines.push('#EXT-X-ENDLIST');
    await fsp.writeFile(path.join(directory, `${role}.m3u8`), `${lines.join('\n')}\n`);
};

const offlineRecords = async options => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'epgstation-offline-'));
    let input = options.inputTs ?? (await generateInput(directory));
    if (options.hevc === true) input = await makeHevcInput(directory, input, options.nonIdrStart === true);
    const inputProbe = await probe(input);
    const duration = Number(inputProbe.format?.duration ?? 0);
    const metadata = { videoFileId: 0, fileSize: Number(inputProbe.format?.size ?? 0), duration, profile: 'measurement-hls', formatVersion: 2 };
    const outputFile = path.join(directory, 'offline.epgodl2');
    const outputFileStream = fs.createWriteStream(outputFile);
    await appendJsonHeader(outputFileStream, metadata);
    const parser = new OfflineStreamParser();
    parser.push(Buffer.concat([getOfflineStreamMagic(), metadataFrame(metadata)]));
    const packager = new Fmp4Packager({ partsPerSegment: 12, mode: 'recorded' }, null);
    const seekSeconds = Number.isFinite(options.seekSeconds) && options.seekSeconds > 0 && options.seekSeconds < duration ? options.seekSeconds : 0;
    const inputSeekArgs = seekSeconds > 0 ? ['-ss', String(seekSeconds)] : [];
    const encoderArgs = options.hevc === true
        ? [
              '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', ...inputSeekArgs, '-i', input,
              '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-tag:v', 'hvc1', '-c:a', 'copy', '-bsf:a', 'aac_adtstoasc',
              '-avoid_negative_ts', 'make_zero', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', '-f', 'mp4', 'pipe:1',
          ]
        : [
              '-hide_banner', '-loglevel', 'error', '-i', input,
              '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'yadif=mode=send_frame:parity=auto:deint=interlaced,format=yuv420p',
              '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '3000k', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
              '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', '-f', 'mp4', 'pipe:1',
          ];
    const encoder = require('node:child_process').spawn('ffmpeg', encoderArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
    const encoderClosed = once(encoder, 'close');
    const records = new OfflineFmp4RecordStream(encoder.stdout, packager);
    const roleStats = new Map();
    let protocolRecordCount = 0;
    let maxRss = process.memoryUsage().rss;
    const rssTimer = setInterval(() => { maxRss = Math.max(maxRss, process.memoryUsage().rss); }, 50);
    const startedAt = process.hrtime.bigint();
    try {
        for await (const record of records) {
            await writeChunk(outputFileStream, record);
            const events = parser.push(record);
            for (const event of events) {
                if (event.type !== 'metadata') protocolRecordCount += 1;
                if (event.type === 'init') {
                    await fsp.writeFile(path.join(directory, `${event.init.role}-init.mp4`), event.init.data);
                } else if (event.type === 'master') {
                    await fsp.writeFile(path.join(directory, 'master.m3u8'), event.data);
                } else if (event.type === 'segment') {
                    const role = event.segment.role;
                    const stat = roleStats.get(role) ?? { durations: [], bytes: 0 };
                    stat.durations.push(event.segment.duration);
                    stat.bytes += event.segment.data.byteLength;
                    roleStats.set(role, stat);
                    await fsp.writeFile(path.join(directory, `${role}-${event.segment.sequence}.m4s`), event.segment.data);
                }
            }
        }
        parser.finish();
        const [encoderCode] = await encoderClosed;
        if (encoderCode !== 0) throw new Error(`ffmpeg exit=${encoderCode}`);
        for (const [role, stat] of roleStats) await buildLocalPlaylist(directory, role, stat.durations);
        const localProbe = await probe(path.join(directory, 'master.m3u8'));
        const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const allDurations = [...roleStats.values()].flatMap(stat => stat.durations);
        const segmentCount = allDurations.length;
        const localDuration = Number(localProbe.format?.duration ?? 0);
        const localStreams = (localProbe.streams ?? []).map(stream => ({ codec_type: stream.codec_type, duration: localDuration }));
        const metrics = {
            input: path.relative(process.cwd(), input),
            saved: path.relative(process.cwd(), outputFile),
            durationSeconds: duration,
            elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
            speed: Number((duration / elapsedSeconds).toFixed(2)),
            seekRequestedSeconds: seekSeconds,
            segmentRecordCount: segmentCount,
            protocolRecordCount,
            recordDurationSeconds: {
                min: Number(Math.min(...allDurations).toFixed(3)),
                max: Number(Math.max(...allDurations).toFixed(3)),
            },
            maxPendingParserBytes: parser.getMaxPendingBytes(),
            maxNodeRssBytes: maxRss,
            maxNodeRssMiB: Number((maxRss / 1024 / 1024).toFixed(1)),
            localHlsStreams: localStreams,
            videoCodec: localProbe.streams?.find(stream => stream.codec_type === 'video')?.codec_name ?? null,
            videoProfile: localProbe.streams?.find(stream => stream.codec_type === 'video')?.profile ?? null,
            videoCodecTag: localProbe.streams?.find(stream => stream.codec_type === 'video')?.codec_tag_string ?? null,
            videoWidth: localProbe.streams?.find(stream => stream.codec_type === 'video')?.width ?? null,
            videoHeight: localProbe.streams?.find(stream => stream.codec_type === 'video')?.height ?? null,
            localHlsDurationSeconds: localDuration,
            measuredSeekOffsetSeconds: seekSeconds > 0 ? Number((duration - localDuration).toFixed(3)) : 0,
        };
        const expectedDuration = Math.max(0, duration - seekSeconds);
        const valid = segmentCount >= 3 && localDuration >= expectedDuration * 0.9 && (!options.hevc || (metrics.videoCodec === 'hevc' && metrics.videoCodecTag === 'hvc1'));
        return result('offline-records', valid, metrics, valid ? null : '生成 HLS が入力尺・HEVC codec tag 条件を満たさない');
    } finally {
        clearInterval(rssTimer);
        outputFileStream.end();
        if (encoder.exitCode === null) encoder.kill('SIGTERM');
    }
};

module.exports = offlineRecords;
