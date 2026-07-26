'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ChannelMap = require('../../dist/model/metadata/syobocal/SyobocalChannelMap').default;
const noopSharedData = { startAutoUpdate: () => {} };

test('falls back to the bundled data when no override path is configured', () => {
    const map = new ChannelMap(
        { getConfig: () => ({}) },
        { getLogger: () => ({ system: { warn: () => {} } }) },
        noopSharedData,
    );
    // NHK総合・東京 (同梱データ)
    const hit = map.find(32736, 1024);
    assert.ok(hit);
    assert.equal(hit.syobocal, true);
});

test('merges an external override file on top of the bundled data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-syobocal-'));
    const file = path.join(dir, 'map.json');
    fs.writeFileSync(
        file,
        JSON.stringify([
            { chId: 999, networkId: 1, serviceId: 2, syobocal: false },
            // 同梱データの上書き (未登録局フラグへ変更)
            { chId: 1, networkId: 32736, serviceId: 1024, syobocal: false },
        ]),
    );
    const map = new ChannelMap(
        { getConfig: () => ({ metadataChannelMappingPath: file }) },
        { getLogger: () => ({ system: { warn: () => {} } }) },
        noopSharedData,
    );
    assert.equal(map.find(1, 2).syobocal, false);
    assert.equal(map.find(32736, 1024).syobocal, false);
    // 上書きされていない同梱データは残る
    assert.ok(map.find(32736, 1040));
});

test('falls back to bundled data when the override path cannot be read (graceful degradation)', () => {
    let warned = false;
    const map = new ChannelMap(
        { getConfig: () => ({ metadataChannelMappingPath: '/no/such/file.json' }) },
        { getLogger: () => ({ system: { warn: () => (warned = true) } }) },
        noopSharedData,
    );
    assert.ok(map.find(32736, 1024));
    assert.equal(warned, true);
});

test('merges shared static data fetched via ISharedDataFetcher (§5.1) on top of bundled data', () => {
    let updateCallback;
    const sharedData = {
        startAutoUpdate: cb => {
            updateCallback = cb;
        },
    };
    const map = new ChannelMap({ getConfig: () => ({}) }, { getLogger: () => ({ system: { warn: () => {} } }) }, sharedData);
    // 取得前は同梱データのみ
    assert.equal(map.find(1, 2), undefined);
    updateCallback({ channelMap: [{ chId: 1, networkId: 1, serviceId: 2, syobocal: true }] });
    assert.ok(map.find(1, 2));
    assert.equal(map.find(1, 2).syobocal, true);
});

test('falls back to bundled data when shared data fetch never succeeds (offline)', () => {
    const map = new ChannelMap(
        { getConfig: () => ({}) },
        { getLogger: () => ({ system: { warn: () => {} } }) },
        { startAutoUpdate: () => {} }, // onUpdate は一度も呼ばれない (取得失敗を模擬)
    );
    assert.ok(map.find(32736, 1024));
});
