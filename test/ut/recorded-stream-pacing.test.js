'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const EncodePresets = require('../../dist/util/EncodePresets').default;
const RecordedStreamBaseModel = require('../../dist/model/service/stream/base/RecordedStreamBaseModel').default;

const pacingArgs = '-readrate 1.5 -readrate_initial_burst 45 -readrate_catchup 2';

test('録画の自動生成コマンドは m2tsll / mp4 / webm を実時間より速く読む', () => {
    const expansion = EncodePresets.expand({ targets: ['liveHLS', 'recordedStreaming'], qualities: ['720p'] });
    const recorded = [...expansion.recordedTs, ...expansion.recordedEncoded];

    for (const profile of recorded.filter(profile => profile.container !== 'hls')) {
        assert.match(profile.cmd, new RegExp(pacingArgs.replaceAll(' ', '\\s+')), profile.id);
    }
    for (const profile of expansion.live) {
        assert.doesNotMatch(profile.cmd, /-readrate(?:_initial_burst|_catchup)?/u, profile.id);
    }
    for (const profile of recorded.filter(profile => profile.container === 'hls')) {
        assert.doesNotMatch(profile.cmd, /-readrate(?:_initial_burst|_catchup)?/u, profile.id);
    }
});

test('録画ストリームの正常なエンコーダ終了は再生中停止として扱わない', () => {
    const model = Object.create(RecordedStreamBaseModel.prototype);
    let exitCount = 0;
    model.getStreamType = () => 'RecordedStream';
    model.isMemoryHLS = () => false;
    model.log = { stream: { info: () => {} } };
    model.emitExitStream = () => {
        exitCount += 1;
    };

    model.onStreamProcessExit(0);
    assert.equal(exitCount, 0);

    model.onStreamProcessExit(1);
    assert.equal(exitCount, 1);
});

test('オフライン HLS はエンコーダ先行抑制を使わず、視聴 HLS は使う', () => {
    const makeModel = isOffline => {
        const model = Object.create(RecordedStreamBaseModel.prototype);
        let paused = 0;
        model.isOfflineHLS = () => isOffline;
        model.isEncodeThrottled = false;
        model.hlsMemoryStore = { getAheadSegmentNum: () => 151 };
        model.streamProcess = { stdout: { pause: () => { paused += 1; }, resume: () => {} } };
        model.log = { stream: { debug: () => {} } };
        return { model, getPaused: () => paused };
    };

    const offline = makeModel(true);
    offline.model.throttleEncodeIfTooFarAhead(1);
    assert.equal(offline.getPaused(), 0);

    const viewing = makeModel(false);
    viewing.model.throttleEncodeIfTooFarAhead(1);
    assert.equal(viewing.getPaused(), 1);
    viewing.model.clearThrottleTimer();
});
