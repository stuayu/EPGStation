'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { HttpStubServer } = require('../support/HttpStubServer');

test('external API stub records requests without internet access', async t => {
    const stub = new HttpStubServer();
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const response = await fetch(`${baseUrl}/contract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'stub' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].url, '/contract');
    assert.deepEqual(JSON.parse(stub.requests[0].body), { provider: 'stub' });
});
