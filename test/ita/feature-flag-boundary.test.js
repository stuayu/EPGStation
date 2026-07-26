'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isFeatureEnabled } = require('../../dist/model/FeatureFlags');

test('feature boundary preserves the legacy path while a flag is off', () => {
    const choosePath = config => (isFeatureEnabled(config, 'seriesLibrary') ? 'series' : 'legacy');

    assert.equal(choosePath({}), 'legacy');
    assert.equal(choosePath({ featureFlags: { seriesLibrary: false } }), 'legacy');
    assert.equal(choosePath({ featureFlags: { seriesLibrary: true } }), 'series');
});
