'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const detailPath = path.join(__dirname, '../../client/src/views/RecordedDetail.vue');
const menuPath = path.join(__dirname, '../../client/src/components/recorded/detail/RecordedDetailMoreButton.vue');

test('CM チャプター推定は録画詳細の既存メニューから遅延実行する', () => {
    const detail = fs.readFileSync(detailPath, 'utf8');
    const menu = fs.readFileSync(menuPath, 'utf8');

    assert.doesNotMatch(detail, /RecordedCmDetectionButton/);
    assert.match(menu, /@Watch\('isOpened'\)/);
    assert.match(menu, /this\.serverConfigModel\.getConfig\(\)\?\.cmDetection\?\.enabled !== true/);
    assert.match(menu, /this\.videoApiModel\.getChapters\(video\.id\)/);
    assert.match(menu, /:fullscreen="isMobile"/);
    assert.match(menu, /status === 409 && message === 'VideoFileAlreadyHasChapters'/);
    assert.match(menu, /status === 400[\s\S]*?TS ファイル以外は推定できません/);
});
