'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Annict = require('../../dist/model/metadata/annict/AnnictWorkDictionary').default;
const Syobocal = require('../../dist/model/metadata/syobocal/SyobocalTitleDictionary').default;
const Wikidata = require('../../dist/model/metadata/wikidata/WikidataProgramDictionary').default;

const entries = [
    { Class: Annict, key: 'workSyncIntervalMs', value: 1234 },
    { Class: Syobocal, key: 'titleSyncIntervalMs', value: 2345 },
    { Class: Wikidata, key: 'syncIntervalMs', value: 3456 },
];
const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
};

async function withTimers(Class, key, initialValue, callback) {
    const timers = [];
    const originalTimeout = global.setTimeout;
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    const provider = Class === Annict ? 'annict' : Class === Syobocal ? 'syobocal' : 'wikidata';
    const setting = { metadata: { [provider]: { enabled: true, token: 'test-token', [key]: initialValue } } };
    const settings = { getAll: async () => setting };
    const logger = { getLogger: () => ({ system: { info() {}, warn() {}, error() {} } }) };
    const config = { getConfig: () => ({ featureFlags: { metadataProviders: true } }) };
    global.setTimeout = (fn, ms) => {
        const timer = { fn, ms, unref() {} };
        timers.push(timer);
        return timer;
    };
    try {
        const args = Class === Annict ? [logger, {}, {}, settings, {}, config, {}] : [logger, {}, {}, settings, config, {}];
        const instance = new Class(...args);
        let syncCount = 0;
        instance.sync = async () => { syncCount++; };
        instance.startAutoSync();
        await flush();
        await callback({
            timers,
            setting: setting.metadata[Object.keys(setting.metadata)[0]],
            getSyncCount: () => syncCount,
            fire: async timer => {
                now += timer.ms;
                await timer.fn();
                await flush();
            },
        });
    } finally {
        global.setTimeout = originalTimeout;
        Date.now = originalNow;
    }
}

for (const { Class, key, value } of entries) {
    test(`${Class.name} は設定間隔で定期同期し、稼働中の変更も次回 cadence に反映する`, async () => {
        await withTimers(Class, key, value, async ({ timers, setting, fire, getSyncCount }) => {
            assert.equal(timers.length, 1);
            const initialDelay = timers[0].ms;
            assert.ok(initialDelay > 0);
            for (let i = 0; i < 10 && getSyncCount() === 0; i++) await fire(timers[timers.length - 1]);
            assert.equal(getSyncCount(), 1);
            assert.equal(timers[timers.length - 1].ms, value);
            setting[key] = 987;
            await fire(timers[timers.length - 1]);
            assert.equal(getSyncCount(), 2);
            assert.equal(timers[timers.length - 1].ms, 987);
        });
    });

    test(`${Class.name} は 0 から正値へ変更した場合も同期を開始する`, async () => {
        await withTimers(Class, key, 0, async ({ timers, setting, fire }) => {
            assert.equal(timers.length, 1);
            const pollDelay = timers[0].ms;
            assert.ok(pollDelay > 0);
            setting[key] = value;
            await fire(timers[0]);
            for (let i = 0; i < 8 && timers.every(timer => timer.ms !== value); i++) {
                await fire(timers[timers.length - 1]);
            }
            assert.ok(timers.some(timer => timer.ms === value));
        });
    });

    test(`${Class.name} は実行中に 0 へ変更されたら sync を止めて設定確認だけを続ける`, async () => {
        await withTimers(Class, key, value, async ({ timers, setting, fire, getSyncCount }) => {
            for (let i = 0; i < 10 && getSyncCount() === 0; i++) await fire(timers[timers.length - 1]);
            assert.equal(getSyncCount(), 1);
            assert.equal(timers[timers.length - 1].ms, value);
            setting[key] = 0;
            await fire(timers[timers.length - 1]);
            assert.equal(getSyncCount(), 1);
            assert.equal(timers[timers.length - 1].ms, 60_000);
        });
    });

    test(`${Class.name} は Node.js の timeout 上限を超えても早期同期しない`, async () => {
        const oversizedInterval = 2_147_483_647 + 1;
        await withTimers(Class, key, oversizedInterval, async ({ timers, fire, getSyncCount }) => {
            for (let i = 0; i < 10 && getSyncCount() === 0; i++) await fire(timers[timers.length - 1]);
            assert.equal(getSyncCount(), 1);
            assert.ok(timers.every(timer => timer.ms <= 2_147_483_647));
            await fire(timers[timers.length - 1]);
            assert.equal(getSyncCount(), 1);
            assert.equal(timers[timers.length - 1].ms, 60_000);
        });
    });
}
