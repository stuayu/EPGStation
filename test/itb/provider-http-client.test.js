'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { HttpStubServer } = require('../support/HttpStubServer');
const ProviderHttpClient = require('../../dist/model/metadata/ProviderHttpClient').default;

test('requests to the same host are serialized (never overlap)', async t => {
    let active = 0;
    let overlapped = false;
    const stub = new HttpStubServer((_req, res) => {
        active++;
        if (active > 1) overlapped = true;
        setTimeout(() => {
            active--;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }, 30);
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const client = new ProviderHttpClient();
    await Promise.all([
        client.get(`${baseUrl}/a`, { minimumIntervalMs: 0 }),
        client.get(`${baseUrl}/b`, { minimumIntervalMs: 0 }),
        client.get(`${baseUrl}/c`, { minimumIntervalMs: 0 }),
    ]);
    assert.equal(overlapped, false, 'requests to the same host must never run concurrently');
    assert.equal(stub.requests.length, 3);
});

test('429 with Retry-After is honored before a successful retry', async t => {
    let attempts = 0;
    let firstAttemptAt = 0;
    let secondAttemptAt = 0;
    const stub = new HttpStubServer((_req, res) => {
        attempts++;
        if (attempts === 1) {
            firstAttemptAt = Date.now();
            res.writeHead(429, { 'retry-after': '1' });
            res.end();
            return;
        }
        secondAttemptAt = Date.now();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const client = new ProviderHttpClient();
    const response = await client.get(`${baseUrl}/rate-limited`, { minimumIntervalMs: 0, attempts: 2 });
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
    assert.ok(secondAttemptAt - firstAttemptAt >= 900, 'must wait roughly Retry-After seconds before retrying');
});
