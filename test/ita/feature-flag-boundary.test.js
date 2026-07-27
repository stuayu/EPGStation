'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isFeatureEnabled } = require('../../dist/model/FeatureFlags');

test('feature boundary preserves the legacy path while a flag is off', () => {
    const choosePath = config => (isFeatureEnabled(config, 'seriesLibrary') ? 'series' : 'legacy');

    // 機能フラグは opt-out。無効化は明示的な false でのみ行う
    assert.equal(choosePath({ featureFlags: { seriesLibrary: false } }), 'legacy');
    assert.equal(choosePath({}), 'series');
    assert.equal(choosePath({ featureFlags: {} }), 'series');
    assert.equal(choosePath({ featureFlags: { seriesLibrary: true } }), 'series');
});
