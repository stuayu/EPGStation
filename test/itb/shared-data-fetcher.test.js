'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { HttpStubServer } = require('../support/HttpStubServer');
const ProviderHttpClient = require('../../dist/model/metadata/ProviderHttpClient').default;
const SharedDataFetcher = require('../../dist/model/metadata/SharedDataFetcher').default;
const MetadataEndpointResolver = require('../../dist/model/metadata/MetadataEndpointResolver').default;

// 結合テストなのでエンドポイント解決も実物を使う (config の URL がそのまま使われることを含めて検証する)
const makeEndpoints = (config, settingsDB = { getAll: async () => ({}) }) =>
    new MetadataEndpointResolver(settingsDB, config);

const cachePath = path.join(__dirname, '..', '..', 'data', 'metadataSharedData.json');
const noopLogger = { getLogger: () => ({ system: { warn: () => {} } }) };
const noopSettingsDB = { getAll: async () => ({}) };

test.beforeEach(() => {
    fs.rmSync(cachePath, { force: true });
    fs.rmSync(`${cachePath}.tmp`, { force: true });
});
test.after(() => {
    fs.rmSync(cachePath, { force: true });
    fs.rmSync(`${cachePath}.tmp`, { force: true });
});

test('fetches shared static data over HTTP and caches it locally (does not re-download every time)', async t => {
    let requests = 0;
    const stub = new HttpStubServer((_req, res) => {
        requests++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ channelMap: [{ chId: 1, networkId: 1, serviceId: 2, syobocal: true }] }));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const config = { getConfig: () => ({ metadataSharedDataUrl: `${baseUrl}/map.json` }) };
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger, noopSettingsDB, makeEndpoints(config, noopSettingsDB));
    const first = await fetcher.fetch();
    assert.equal(first.channelMap[0].chId, 1);
    assert.equal(requests, 1);
    assert.ok(fs.existsSync(cachePath), 'the fetched payload must be cached locally');
});

test('falls back to the last local cache when the remote host is unreachable (offline)', async () => {
    const config = { getConfig: () => ({ metadataSharedDataUrl: 'http://127.0.0.1:1/unreachable' }) };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ channelMap: [{ chId: 9, networkId: 9, serviceId: 9 }] }));

    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger, noopSettingsDB, makeEndpoints(config, noopSettingsDB));
    const result = await fetcher.fetch();
    assert.equal(result.channelMap[0].chId, 9);
});

test('returns null (bundled-data fallback is the caller responsibility) when there is no URL and no cache', async () => {
    const config = { getConfig: () => ({}) };
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger, noopSettingsDB, makeEndpoints(config, noopSettingsDB));
    assert.equal(await fetcher.fetch(), null);
});

test('startAutoUpdate fetches immediately and invokes the callback on success', async t => {
    const stub = new HttpStubServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ channelMap: [{ chId: 5, networkId: 5, serviceId: 5 }] }));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const config = {
        getConfig: () => ({ metadataSharedDataUrl: `${baseUrl}/map.json`, metadataSharedDataUpdateIntervalMs: 0 }),
    };
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger, noopSettingsDB, makeEndpoints(config, noopSettingsDB));
    const received = await new Promise(resolve => fetcher.startAutoUpdate(resolve));
    assert.equal(received.channelMap[0].chId, 5);
});

// 自動更新 ON/OFF (§5.8・§6.2): DB 設定 (metadata.sharedData.autoUpdate) が false の場合、
// 定期実行のタイミングでは取得をスキップする。startAutoUpdate() は初回呼び出しでも判定するため
// received コールバックは呼ばれない
test('startAutoUpdate skips the fetch when metadata.sharedData.autoUpdate is disabled via DB settings', async t => {
    let requests = 0;
    const stub = new HttpStubServer((_req, res) => {
        requests++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ channelMap: [{ chId: 5, networkId: 5, serviceId: 5 }] }));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const config = {
        getConfig: () => ({ metadataSharedDataUrl: `${baseUrl}/map.json`, metadataSharedDataUpdateIntervalMs: 0 }),
    };
    const disabledSettingsDB = { getAll: async () => ({ metadata: { sharedData: { autoUpdate: false } } }) };
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger, disabledSettingsDB, makeEndpoints(config, disabledSettingsDB));
    let called = false;
    fetcher.startAutoUpdate(() => (called = true));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(called, false);
    assert.equal(requests, 0);
});

// 「今すぐ同期」(§5.7・§6.2): 自動更新が OFF でも syncNow() は即座に取得し、
// startAutoUpdate() に登録済みのコールバックを呼ぶ
test('syncNow() fetches immediately and invokes the registered callback even while auto-update is disabled', async t => {
    const stub = new HttpStubServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ channelMap: [{ chId: 7, networkId: 7, serviceId: 7 }] }));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const config = {
        getConfig: () => ({ metadataSharedDataUrl: `${baseUrl}/map.json`, metadataSharedDataUpdateIntervalMs: 0 }),
    };
    const disabledSettingsDB = { getAll: async () => ({ metadata: { sharedData: { autoUpdate: false } } }) };
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger, disabledSettingsDB, makeEndpoints(config, disabledSettingsDB));
    let received = null;
    fetcher.startAutoUpdate(payload => (received = payload));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(received, null, 'auto-update must have been skipped first');

    const result = await fetcher.syncNow();
    assert.equal(result.channelMap[0].chId, 7);
    assert.ok(received, 'syncNow() must invoke the callback registered via startAutoUpdate()');
    assert.equal(received.channelMap[0].chId, 7);
});
