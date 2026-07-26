'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const AppSettingApiModel = require('../../dist/model/api/config/AppSettingApiModel').default;
const SecretCrypto = require('../../dist/model/security/SecretCrypto').default;

const configuration = { getConfig: () => ({ featureFlags: { systemSettings: true }, secretKey: 'test-key' }) };

test('system settings encrypt secrets, mask responses, and preserve masked updates', async () => {
    let stored = {};
    const db = {
        getAll: async () => stored,
        upsert: async values => { stored = { ...stored, ...values }; },
    };
    const crypto = new SecretCrypto(configuration);
    const model = new AppSettingApiModel(configuration, db, crypto);
    const first = await model.update({ metadata: { annict: { token: 'token-1234' } } });
    assert.match(stored.metadata.annict.token, /^enc:v1:/);
    assert.equal(first.metadata.annict.token, '********1234');
    const encrypted = stored.metadata.annict.token;
    await model.update({ metadata: { annict: { token: '********1234' } } });
    assert.equal(stored.metadata.annict.token, encrypted);
    assert.equal((await model.get()).metadata.annict.token, '********1234');
});

test('system settings rejects access while feature is disabled', async () => {
    const model = new AppSettingApiModel(
        { getConfig: () => ({ featureFlags: {} }) },
        { getAll: async () => ({}) },
        new SecretCrypto({ getConfig: () => ({ secretKey: 'x' }) }),
    );
    await assert.rejects(() => model.get(), /SystemSettingsFeatureIsDisabled/);
});
