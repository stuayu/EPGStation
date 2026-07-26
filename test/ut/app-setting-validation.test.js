'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { validateAppSettings } = require('../../dist/model/api/config/AppSettingApiModel');
const { validateAppSettingValue, appSettingRequiresRestart } = require('../../dist/model/api/config/AppSettingSchema');

test('settings accepts known sections', () => assert.doesNotThrow(() => validateAppSettings({ notifications: {} })));
test('settings rejects unknown sections', () =>
    assert.throws(() => validateAppSettings({ danger: true }), /UnknownAppSetting/));

test('validateAppSettingValue rejects an unknown top-level key', () => {
    assert.throws(() => validateAppSettingValue('danger', {}), /UnknownAppSetting/);
});

test('validateAppSettingValue rejects a wrong type', () => {
    assert.throws(
        () => validateAppSettingValue('metadata', { cacheTtlMs: 'not-a-number' }),
        /expected number but got string/,
    );
});

test('validateAppSettingValue enforces numeric boundaries (inclusive)', () => {
    assert.doesNotThrow(() => validateAppSettingValue('series', { matchThreshold: 0 }));
    assert.doesNotThrow(() => validateAppSettingValue('series', { matchThreshold: 1 }));
    assert.throws(() => validateAppSettingValue('series', { matchThreshold: 1.01 }), /must be <= 1/);
    assert.throws(() => validateAppSettingValue('series', { matchThreshold: -0.01 }), /must be >= 0/);
});

test('validateAppSettingValue rejects non-finite numbers', () => {
    assert.throws(() => validateAppSettingValue('series', { matchThreshold: NaN }), /must be finite number/);
    assert.throws(() => validateAppSettingValue('series', { matchThreshold: Infinity }), /must be finite number/);
});

test('validateAppSettingValue enforces string maxLength', () => {
    const tooLong = 'a'.repeat(501);
    assert.throws(
        () => validateAppSettingValue('notifications', { targets: [{ name: 'x', type: 'webhook', url: 'u', secret: tooLong }] }),
        /string too long/,
    );
});

test('validateAppSettingValue enforces enum values', () => {
    assert.throws(
        () => validateAppSettingValue('notifications', { targets: [{ name: 'x', type: 'unknown-type', url: 'u' }] }),
        /must be one of/,
    );
});

test('validateAppSettingValue requires notification target required fields', () => {
    assert.throws(
        () => validateAppSettingValue('notifications', { targets: [{ type: 'webhook' }] }),
        /required/,
    );
});

test('validateAppSettingValue rejects an oversized value (256KB cap)', () => {
    const huge = { targets: [{ name: 'x', type: 'webhook', url: 'u', events: new Array(20000).fill('recording.started') }] };
    assert.throws(() => validateAppSettingValue('notifications', huge), /value too large/);
});

test('appSettingRequiresRestart reflects the schema declarations (currently none require a restart)', () => {
    assert.equal(appSettingRequiresRestart('notifications'), false);
    assert.equal(appSettingRequiresRestart('metadata'), false);
    assert.equal(appSettingRequiresRestart('unknown-key'), false);
});
