const assert = require('node:assert/strict');
const { test } = require('node:test');
const route = require('../../dist/model/service/api/streams/recorded/{videoFileId}/m2tsll.js');

test('録画 M2TS-LL ルートは mode/profile/audioTrack と video/mp2t を公開する', () => {
    assert.equal(typeof route.get, 'function');
    assert.deepEqual(
        route.get.apiDoc.parameters.map(parameter => parameter.$ref),
        [
            '#/components/parameters/PathVideoFileId',
            '#/components/parameters/StreamPlayPosition',
            '#/components/parameters/StreamMode',
            '#/components/parameters/StreamProfile',
            '#/components/parameters/StreamAudioTrack',
        ],
    );
    assert.ok(route.get.apiDoc.responses[200].content['video/mp2t']);
});
