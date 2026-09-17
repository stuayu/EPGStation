'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const route = require('../../dist/model/service/api/videos/{videoFileId}/offline.js');

test('オフライン保存ルートは HEVC fMP4 用 format クエリを公開する', () => {
    assert.deepEqual(
        route.get.apiDoc.parameters.map(parameter => parameter.$ref),
        [
            '#/components/parameters/PathVideoFileId',
            '#/components/parameters/PlaybackProfile',
            '#/components/parameters/OfflineVideoFormat',
            '#/components/parameters/StreamAudioTrack',
        ],
    );
});
