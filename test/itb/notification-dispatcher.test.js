'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { HttpStubServer } = require('../support/HttpStubServer');
const NotificationDispatcher = require('../../dist/model/notification/NotificationDispatcher').default;
test('notification dispatcher retries and eventually succeeds', async t => {
    let attempts = 0;
    const stub = new HttpStubServer((_req, res) => {
        attempts++;
        res.writeHead(attempts === 1 ? 500 : 200);
        res.end();
    });
    const url = await stub.start();
    t.after(() => stub.stop());
    const errors = [];
    const config = {
        getConfig: () => ({
            featureFlags: { notifications: true },
            notifications: {
                targets: [{ name: 'test', type: 'webhook', url }],
                maxAttempts: 3,
                baseDelayMs: 1,
                timeoutMs: 1000,
            },
        }),
    };
    const dispatcher = new NotificationDispatcher(
        config,
        { getLogger: () => ({ system: { error: e => errors.push(e) } }) },
        { getAll: async () => ({}) },
        { isEncrypted: () => false, decrypt: value => value },
    );
    await dispatcher.dispatch('recording.started', { name: 'test' });
    assert.equal(attempts, 2);
    assert.equal(errors.length, 0);
});
test('notification dispatcher is a no-op while disabled', async () => {
    const dispatcher = new NotificationDispatcher(
        { getConfig: () => ({ featureFlags: {} }) },
        {
            getLogger: () => ({
                system: {
                    error: () => {
                        throw new Error('unexpected');
                    },
                },
            }),
        },
        { getAll: async () => ({}) },
        { isEncrypted: () => false, decrypt: value => value },
    );
    await dispatcher.dispatch('recording.failed', { name: 'x' });
});
