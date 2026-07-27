'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FEATURE_FLAG_KEYS } = require('../../dist/model/IConfigFile');
const { isFeatureEnabled, resolveFeatureFlags } = require('../../dist/model/FeatureFlags');

test('all features are enabled when configuration is omitted', () => {
    const resolved = resolveFeatureFlags();

    assert.deepEqual(Object.keys(resolved), [...FEATURE_FLAG_KEYS]);
    for (const key of FEATURE_FLAG_KEYS) {
        assert.equal(resolved[key], true, `${key} must default to true`);
    }
});

test('only explicitly false flags are disabled', () => {
    const config = { featureFlags: { watchHistory: true, dashboard: false } };

    assert.equal(isFeatureEnabled(config, 'watchHistory'), true);
    assert.equal(isFeatureEnabled(config, 'dashboard'), false);
    // 書かれていない機能は有効 (opt-out)
    assert.equal(isFeatureEnabled(config, 'seriesLibrary'), true);
});

test('featureFlags itself may be omitted entirely', () => {
    assert.equal(isFeatureEnabled({}, 'seriesLibrary'), true);
});

test('resolved flags are immutable and missing values stay enabled', () => {
    const resolved = resolveFeatureFlags({ seriesLibrary: false });

    assert.equal(resolved.seriesLibrary, false);
    assert.equal(resolved.annictSync, true);
    assert.equal(Object.isFrozen(resolved), true);
});
