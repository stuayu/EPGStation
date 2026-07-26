'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ChannelMap = require('../../dist/model/metadata/syobocal/SyobocalChannelMap').default;

test('falls back to the bundled data when no override path is configured', () => {
    const map = new ChannelMap({ getConfig: () => ({}) }, { getLogger: () => ({ system: { warn: () => {} } }) });
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
    );
    assert.ok(map.find(32736, 1024));
    assert.equal(warned, true);
});
