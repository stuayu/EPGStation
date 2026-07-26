'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FEATURE_FLAG_KEYS } = require('../../dist/model/IConfigFile');
const { isFeatureEnabled, resolveFeatureFlags } = require('../../dist/model/FeatureFlags');

test('all planned features are disabled when configuration is omitted', () => {
    const resolved = resolveFeatureFlags();

    assert.deepEqual(Object.keys(resolved), [...FEATURE_FLAG_KEYS]);
    for (const key of FEATURE_FLAG_KEYS) {
        assert.equal(resolved[key], false, `${key} must default to false`);
    }
});

test('only explicitly true flags are enabled', () => {
    const config = { featureFlags: { watchHistory: true, dashboard: false } };

    assert.equal(isFeatureEnabled(config, 'watchHistory'), true);
    assert.equal(isFeatureEnabled(config, 'dashboard'), false);
    assert.equal(isFeatureEnabled(config, 'seriesLibrary'), false);
});

test('resolved flags are immutable and missing values remain disabled', () => {
    const resolved = resolveFeatureFlags({ seriesLibrary: true });

    assert.equal(resolved.seriesLibrary, true);
    assert.equal(resolved.annictSync, false);
    assert.equal(Object.isFrozen(resolved), true);
});
