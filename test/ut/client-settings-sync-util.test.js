'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ALLOW_LIST = { settings: ['themeColor', 'muted'], GuideGenreSetting: ['1'] };

test('client settings sync extracts only allowlisted keys and merges without replacing device-only values', async () => {
    const { extractSyncableSettings, mergeSyncableSettings } = require('../../dist/util/ClientSettingsSyncUtil');
    const current = {
        settings: { themeColor: 'blue', muted: true, localUrl: 'http://device' },
        GuideGenreSetting: { 1: false, 2: true },
    };
    assert.deepEqual(extractSyncableSettings(current, ALLOW_LIST), {
        settings: { themeColor: 'blue', muted: true },
        GuideGenreSetting: { 1: false },
    });
    assert.deepEqual(
        mergeSyncableSettings(current, { settings: { themeColor: 'red', localUrl: 'http://other' } }, ALLOW_LIST),
        {
            settings: { themeColor: 'red', muted: true, localUrl: 'http://device' },
            GuideGenreSetting: { 1: false, 2: true },
        },
    );
});
