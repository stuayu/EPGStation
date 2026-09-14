'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    shouldUseEncodedTsSubtitleReader,
    createRecordedSubtitleReaderArgs,
} = require('../../dist/util/RecordedSubtitleUtil');

const hevcTs = { transport: 'mpegts', codec: 'hevc' };

test('encoded 扱いの MPEG-TS HLS は字幕 reader を有効にする', () => {
    assert.equal(shouldUseEncodedTsSubtitleReader('encoded', 'hls', hevcTs), true);
    assert.equal(shouldUseEncodedTsSubtitleReader('encoded', 'hls', { transport: 'mp4', codec: 'hevc' }), false);
    assert.equal(shouldUseEncodedTsSubtitleReader('encoded', 'hls', null), false);
    assert.equal(shouldUseEncodedTsSubtitleReader('ts', 'hls', hevcTs), false);
    assert.equal(shouldUseEncodedTsSubtitleReader('encoded', 'mp4', hevcTs), false);
});

test('字幕 reader は映像と同じ秒位置を ffmpeg の入力 seek へ渡す', () => {
    assert.deepEqual(createRecordedSubtitleReaderArgs('/recorded/hevc.ts', 300), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-fflags',
        '+genpts',
        '-ss',
        '300',
        '-i',
        '/recorded/hevc.ts',
        '-map',
        '0:s:0?',
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-f',
        'mpegts',
        'pipe:1',
    ]);
});
