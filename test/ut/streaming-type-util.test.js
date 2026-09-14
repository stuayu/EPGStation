'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    RECORDED_STREAM_TYPE_LABELS,
    RECORDED_STREAMING_TYPES,
    STREAMING_TYPE_LABELS,
    STREAMING_TYPES,
    parseRecordedStreamingType,
    parseStreamingType,
    toStreamingType,
} = require('../../dist/util/StreamingTypeUtil');
const { isRecordedWatchModeValid, isWatchModeInRange, parseWatchRouteInteger } = require('../../dist/util/WatchRouteParamUtil');

test('ライブ配信方式ラベルの全要素を API のパス名へ明示的に変換する', () => {
    assert.deepEqual(
        STREAMING_TYPE_LABELS.map(label => toStreamingType(label)),
        ['m2ts', 'm2tsll', 'webm', 'mp4', 'hls'],
    );
    assert.equal(toStreamingType('M2TS-LL'), 'm2tsll');
});

test('録画配信方式ラベルの全要素を API のパス名へ明示的に変換する', () => {
    assert.deepEqual(
        RECORDED_STREAM_TYPE_LABELS.map(label => toStreamingType(label)),
        ['webm', 'mp4', 'hls', 'm2tsll', 'original'],
    );
});

test('ライブ配信の API パス名は URL query の検証を通過する', () => {
    for (const streamingType of STREAMING_TYPES) {
        assert.equal(parseStreamingType(streamingType), streamingType);
    }
    assert.equal(parseStreamingType('m2ts-ll'), null);
    assert.equal(parseStreamingType('unknown'), null);
    assert.equal(parseStreamingType(undefined), null);
});

test('録画配信の API パス名は URL query の検証を通過する', () => {
    for (const streamingType of RECORDED_STREAMING_TYPES) {
        assert.equal(parseRecordedStreamingType(streamingType), streamingType);
    }
    assert.equal(parseRecordedStreamingType('m2ts-ll'), null);
    assert.equal(parseRecordedStreamingType('unknown'), null);
    assert.equal(parseRecordedStreamingType(undefined), null);
});

const getStreamRouteTypes = routeDirectory =>
    fs
        .readdirSync(routeDirectory)
        .filter(fileName => fileName.endsWith('.ts') && fileName !== 'playback-options.ts')
        .map(fileName => path.basename(fileName, '.ts'))
        .sort();

test('録画配信の変換表は API 側の録画ストリーム実装一覧と一致する', () => {
    const routeDirectory = path.join(__dirname, '../../src/model/service/api/streams/recorded/{videoFileId}');
    const routeTypes = getStreamRouteTypes(routeDirectory);
    // Original MPEG-2 は再エンコード用ストリームではなく、動画ファイル API の Range 経路。
    routeTypes.push('original');

    assert.deepEqual([...RECORDED_STREAMING_TYPES].sort(), routeTypes.sort());
});

test('視聴 URL の整数は厳密に検証し、録画 ID は正数だけを受け付ける', () => {
    assert.equal(parseWatchRouteInteger('31024', 1), 31024);
    assert.equal(parseWatchRouteInteger('0', 1), null);
    assert.equal(parseWatchRouteInteger('-1', 0), null);
    assert.equal(parseWatchRouteInteger('1abc', 0), null);
    assert.equal(parseWatchRouteInteger('1.5', 0), null);
    assert.equal(parseWatchRouteInteger('9007199254740992', 1), null);
});

test('mode は config の範囲外を拒否し、旧 config の空一覧では非負整数を許可する', () => {
    assert.equal(isWatchModeInRange(0, ['低', '高']), true);
    assert.equal(isWatchModeInRange(2, ['低', '高']), false);
    assert.equal(isWatchModeInRange(-1, ['低']), false);
    assert.equal(isWatchModeInRange(999, []), true);
});

test('録画視聴は profile 指定時だけ config の mode 範囲検査を省略する', () => {
    assert.equal(isRecordedWatchModeValid(99, ['低'], 'custom-720'), true);
    assert.equal(isRecordedWatchModeValid(99, ['低']), false);
    assert.equal(isRecordedWatchModeValid(0, ['低']), true);
});

test('ライブ配信の変換表は API 側のライブストリーム実装一覧と一致する', () => {
    const routeDirectory = path.join(__dirname, '../../src/model/service/api/streams/live/{channelId}');
    const routeTypes = getStreamRouteTypes(routeDirectory);

    assert.deepEqual([...STREAMING_TYPES].sort(), routeTypes);
});
