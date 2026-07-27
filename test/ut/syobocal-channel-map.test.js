'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ChannelMap = require('../../dist/model/metadata/syobocal/SyobocalChannelMap').default;
const noopSharedData = { startAutoUpdate: () => {} };
const noopSettingsDB = { getAll: async () => ({}) };

test('falls back to the bundled data when no override path is configured', () => {
    const map = new ChannelMap(
        { getConfig: () => ({}) },
        { getLogger: () => ({ system: { warn: () => {} } }) },
        noopSharedData,
        noopSettingsDB,
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
        noopSettingsDB,
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
        noopSettingsDB,
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
    const map = new ChannelMap({ getConfig: () => ({}) }, { getLogger: () => ({ system: { warn: () => {} } }) }, sharedData, noopSettingsDB);
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
        noopSettingsDB,
    );
    assert.ok(map.find(32736, 1024));
});

// DB 設定 (§6.2) の解決順: 同梱 → 共有静的データ → ローカルファイル → DB 設定 の順で後勝ちなので、
// DB 設定が同梱データより優先される
test('merges DB-stored channel map (settings screen edits) on top of everything else (§6.2)', async () => {
    const settingsDB = {
        getAll: async () => ({
            syobocalChannelMap: [{ chId: 1, networkId: 32736, serviceId: 1024, syobocal: false }],
        }),
    };
    const map = new ChannelMap(
        { getConfig: () => ({}) },
        { getLogger: () => ({ system: { warn: () => {} } }) },
        noopSharedData,
        settingsDB,
    );
    await map.refreshFromDb();
    assert.equal(map.find(32736, 1024).syobocal, false);
});

test('DB-stored channel map overrides even an explicit local override file (highest priority)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-syobocal-'));
    const file = path.join(dir, 'map.json');
    fs.writeFileSync(file, JSON.stringify([{ chId: 1, networkId: 5, serviceId: 6, syobocal: true }]));
    const settingsDB = {
        getAll: async () => ({
            syobocalChannelMap: [{ chId: 1, networkId: 5, serviceId: 6, syobocal: false }],
        }),
    };
    const map = new ChannelMap(
        { getConfig: () => ({ metadataChannelMappingPath: file }) },
        { getLogger: () => ({ system: { warn: () => {} } }) },
        noopSharedData,
        settingsDB,
    );
    await map.refreshFromDb();
    assert.equal(map.find(5, 6).syobocal, false);
});
