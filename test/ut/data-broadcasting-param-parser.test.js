'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { parseDataBroadcastingParam } = require('../../dist/model/service/dataBroadcasting/DataBroadcastingParamParser');

// データ放送 WebSocket の `?param=<JSON>` クエリ検証のテスト。
// 不正な形式はすべて null を返し、呼び出し側 (DataBroadcastingWebSocketServer) が 1008 で切断する

function withParam(value) {
    return `/api/dataBroadcasting/ws?param=${encodeURIComponent(JSON.stringify(value))}`;
}

test('parses a valid live param', () => {
    const result = parseDataBroadcastingParam(withParam({ type: 'epgStationLive', channelId: 3239123608 }));
    assert.deepEqual(result, {
        type: 'epgStationLive',
        channelId: 3239123608,
        demultiplexServiceId: undefined,
    });
});

test('parses a valid live param with demultiplexServiceId', () => {
    const result = parseDataBroadcastingParam(
        withParam({ type: 'epgStationLive', channelId: 1, demultiplexServiceId: 101 }),
    );
    assert.deepEqual(result, {
        type: 'epgStationLive',
        channelId: 1,
        demultiplexServiceId: 101,
    });
});

test('parses a valid recorded param', () => {
    const result = parseDataBroadcastingParam(withParam({ type: 'epgStationRecorded', videoFileId: 42 }));
    assert.deepEqual(result, {
        type: 'epgStationRecorded',
        videoFileId: 42,
        seek: undefined,
        demultiplexServiceId: undefined,
    });
});

test('parses a valid recorded param with seek', () => {
    const result = parseDataBroadcastingParam(withParam({ type: 'epgStationRecorded', videoFileId: 42, seek: 1024 }));
    assert.deepEqual(result, {
        type: 'epgStationRecorded',
        videoFileId: 42,
        seek: 1024,
        demultiplexServiceId: undefined,
    });
});

test('returns null when url is undefined', () => {
    assert.equal(parseDataBroadcastingParam(undefined), null);
});

test('returns null when param query is missing', () => {
    assert.equal(parseDataBroadcastingParam('/api/dataBroadcasting/ws'), null);
});

test('returns null when param is not valid JSON', () => {
    assert.equal(parseDataBroadcastingParam('/api/dataBroadcasting/ws?param=not-json'), null);
});

test('returns null when param is a JSON primitive (not an object)', () => {
    assert.equal(parseDataBroadcastingParam(withParam(1)), null);
    assert.equal(parseDataBroadcastingParam(withParam(null)), null);
    assert.equal(parseDataBroadcastingParam(withParam('str')), null);
});

test('returns null for unknown type', () => {
    assert.equal(parseDataBroadcastingParam(withParam({ type: 'mirakLive', channelType: 'GR', channel: '27' })), null);
});

test('returns null when channelId is missing or wrong type for live', () => {
    assert.equal(parseDataBroadcastingParam(withParam({ type: 'epgStationLive' })), null);
    assert.equal(parseDataBroadcastingParam(withParam({ type: 'epgStationLive', channelId: '1' })), null);
});

test('returns null when videoFileId is missing or wrong type for recorded', () => {
    assert.equal(parseDataBroadcastingParam(withParam({ type: 'epgStationRecorded' })), null);
    assert.equal(parseDataBroadcastingParam(withParam({ type: 'epgStationRecorded', videoFileId: '42' })), null);
});

test('ignores non-numeric demultiplexServiceId / seek', () => {
    const result = parseDataBroadcastingParam(
        withParam({ type: 'epgStationRecorded', videoFileId: 1, seek: 'abc', demultiplexServiceId: 'abc' }),
    );
    assert.deepEqual(result, {
        type: 'epgStationRecorded',
        videoFileId: 1,
        seek: undefined,
        demultiplexServiceId: undefined,
    });
});
