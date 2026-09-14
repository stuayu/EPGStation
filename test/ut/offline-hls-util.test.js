'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseOfflineHlsAudioTracks } = require('../../dist/util/OfflineHlsUtil');

test('保存済み master の主音声・副音声 rendition を順番どおり復元する', () => {
    const master = [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="主音声",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="jpn",URI="audio0.m3u8"',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="副音声",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="jpn",URI="audio1.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="hvc1.2.4.L153.B0,mp4a.40.2",AUDIO="audio"',
        'video.m3u8',
    ].join('\n');

    assert.deepEqual(parseOfflineHlsAudioTracks(master), [
        { track: '0', name: '主音声', streamIndex: 0, isDualMono: false, codec: null, language: 'jpn', channels: null },
        { track: '1', name: '副音声', streamIndex: 1, isDualMono: false, codec: null, language: 'jpn', channels: null },
    ]);
});

test('音声以外の EXT-X-MEDIA と URI のない項目は切替一覧へ出さない', () => {
    const master = [
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitle",NAME="字幕",URI="subtitle.m3u8"',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="主音声",DEFAULT=YES',
    ].join('\n');
    assert.deepEqual(parseOfflineHlsAudioTracks(master), []);
});
