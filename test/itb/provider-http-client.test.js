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

// 429 を受けたホストは以後の最小間隔を引き上げる (同じ同期の続きで叩き続けて弾かれ続けるのを防ぐ)
test('a host that returned 429 gets a longer minimum interval for later requests', async t => {
    let attempts = 0;
    const stub = new HttpStubServer((_req, res) => {
        attempts++;
        if (attempts === 1) {
            res.writeHead(429, { 'retry-after': '0' });
            res.end();
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const client = new ProviderHttpClient();
    // 1 回目で 429 → リトライして成功 (この時点でホストの間隔が引き上げられる)
    assert.equal((await client.get(`${baseUrl}/a`, { attempts: 2 })).status, 200);

    const startedAt = Date.now();
    assert.equal((await client.get(`${baseUrl}/b`)).status, 200);
    // 既定の 250ms ではなく引き上げ後の間隔 (500ms 以上) だけ待つ
    assert.ok(Date.now() - startedAt >= 400, 'the throttled interval must be applied to later requests');
});

// 呼び出し側が明示した間隔は引き上げより優先される (テスト・特殊用途で待ちを外せる)
test('an explicit minimumIntervalMs overrides the throttled interval', async t => {
    let attempts = 0;
    const stub = new HttpStubServer((_req, res) => {
        attempts++;
        if (attempts === 1) {
            res.writeHead(429, { 'retry-after': '0' });
            res.end();
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const client = new ProviderHttpClient();
    await client.get(`${baseUrl}/a`, { attempts: 2 });
    const startedAt = Date.now();
    await client.get(`${baseUrl}/b`, { minimumIntervalMs: 0 });
    assert.ok(Date.now() - startedAt < 300);
});
