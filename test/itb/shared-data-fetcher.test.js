'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { HttpStubServer } = require('../support/HttpStubServer');
const ProviderHttpClient = require('../../dist/model/metadata/ProviderHttpClient').default;
const SharedDataFetcher = require('../../dist/model/metadata/SharedDataFetcher').default;

const cachePath = path.join(__dirname, '..', '..', 'data', 'metadataSharedData.json');
const noopLogger = { getLogger: () => ({ system: { warn: () => {} } }) };

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
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger);
    const first = await fetcher.fetch();
    assert.equal(first.channelMap[0].chId, 1);
    assert.equal(requests, 1);
    assert.ok(fs.existsSync(cachePath), 'the fetched payload must be cached locally');
});

test('falls back to the last local cache when the remote host is unreachable (offline)', async () => {
    const config = { getConfig: () => ({ metadataSharedDataUrl: 'http://127.0.0.1:1/unreachable' }) };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ channelMap: [{ chId: 9, networkId: 9, serviceId: 9 }] }));

    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger);
    const result = await fetcher.fetch();
    assert.equal(result.channelMap[0].chId, 9);
});

test('returns null (bundled-data fallback is the caller responsibility) when there is no URL and no cache', async () => {
    const config = { getConfig: () => ({}) };
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger);
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
    const fetcher = new SharedDataFetcher(config, new ProviderHttpClient(), noopLogger);
    const received = await new Promise(resolve => fetcher.startAutoUpdate(resolve));
    assert.equal(received.channelMap[0].chId, 5);
});
