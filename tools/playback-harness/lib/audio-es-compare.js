'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { compareDecodedAudio } = require('../../../dist/util/OriginalHevcUtil');
const { result } = require('./output');

const execFileAsync = promisify(execFile);
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const DEFAULT_SECONDS = 3;
const TIMEOUT_MS = 5000;

const decode = async (ffmpeg, input, streamIndex, start, seconds) => {
    const { stdout } = await execFileAsync(
        ffmpeg,
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-ss',
            String(Math.max(0, start)),
            '-i',
            input,
            '-map',
            `0:a:${streamIndex}`,
            '-t',
            String(seconds),
            '-vn',
            '-sn',
            '-dn',
            '-ac',
            '1',
            '-ar',
            String(SAMPLE_RATE),
            '-f',
            's16le',
            'pipe:1',
        ],
        { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: TIMEOUT_MS, killSignal: 'SIGKILL' },
    );
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
};

const summarize = pcm => {
    if (pcm.length === 0 || pcm.length % BYTES_PER_SAMPLE !== 0) return null;
    let sum = 0;
    let max = 0;
    const sampleCount = pcm.length / BYTES_PER_SAMPLE;
    for (let offset = 0; offset < pcm.length; offset += BYTES_PER_SAMPLE) {
        const amplitude = Math.abs(pcm.readInt16LE(offset));
        sum += amplitude;
        max = Math.max(max, amplitude);
    }
    return { sampleCount, meanAbsoluteAmplitude: sum / sampleCount, maxAbsoluteAmplitude: max };
};

/** 2 本の音声 ES を同じ窓で比較する。34334 の主音声/音声2の実体確認に使う。 */
const runAudioEsCompare = async options => {
    if (typeof options.inputTs !== 'string' || options.inputTs.length === 0) {
        return result('audio-es-compare', false, {}, '--input-ts が必要');
    }

    const start = Number.isFinite(options.ss) ? options.ss : 0;
    const seconds = Number.isFinite(options.audioProbeSeconds) && options.audioProbeSeconds > 0 ? options.audioProbeSeconds : DEFAULT_SECONDS;
    const ffmpeg = options.ffmpeg ?? 'ffmpeg';
    try {
        const [first, second] = await Promise.all([
            decode(ffmpeg, options.inputTs, 0, start, seconds),
            decode(ffmpeg, options.inputTs, 1, start, seconds),
        ]);
        const firstSummary = summarize(first);
        const secondSummary = summarize(second);
        const commonBytes = Math.min(first.byteLength, second.byteLength);
        const comparison = compareDecodedAudio(first.subarray(0, commonBytes), second.subarray(0, commonBytes));
        const secondIsSilent = secondSummary === null || secondSummary.meanAbsoluteAmplitude < 1;
        const passed = comparison !== undefined && secondIsSilent === false && comparison.meanAbsoluteDifference > 1;
        return result(
            'audio-es-compare',
            passed,
            {
                inputTs: options.inputTs,
                start,
                seconds,
                first: firstSummary,
                second: secondSummary,
                comparison,
                secondIsSilent,
            },
            passed ? null : '2 本の音声 ES が別音声として確認できない',
        );
    } catch (error) {
        return result(
            'audio-es-compare',
            false,
            { inputTs: options.inputTs, start, seconds },
            error instanceof Error ? error.message : String(error),
        );
    }
};

module.exports = runAudioEsCompare;
