'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { validateClientSettings } = require('../../dist/model/api/clientSettings/ClientSettingsApiUtil');

test('client settings validation accepts JSON objects up to 256 KiB and rejects invalid or oversized values', () => {
    assert.equal(validateClientSettings({ value: 'x'.repeat(256 * 1024 - 12) }), null);
    assert.equal(validateClientSettings({ value: 'x'.repeat(256 * 1024) }), 'ClientSettingsTooLarge');
    assert.equal(validateClientSettings(null), 'InvalidClientSettings');
    assert.equal(validateClientSettings([]), 'InvalidClientSettings');
    assert.equal(validateClientSettings('settings'), 'InvalidClientSettings');
});
