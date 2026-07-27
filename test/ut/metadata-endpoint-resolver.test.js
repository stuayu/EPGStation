'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const MetadataEndpointResolver = require('../../dist/model/metadata/MetadataEndpointResolver').default;

function make({ dbEndpoints, configDefaults, metadataSharedDataUrl } = {}) {
    const settings = { getAll: async () => ({ metadata: dbEndpoints ? { endpoints: dbEndpoints } : {} }) };
    const config = {
        getConfig: () => ({
            metadataDefaults: configDefaults ? { endpoints: configDefaults } : {},
            metadataSharedDataUrl,
        }),
    };
    return new MetadataEndpointResolver(settings, config);
}

test('resolve() falls back to the bundled defaults when nothing is configured', async () => {
    const resolver = make();
    assert.equal(await resolver.resolve('syobocal'), 'https://cal.syoboi.jp/db.php');
    assert.equal(await resolver.resolve('annict'), 'https://api.annict.com/graphql');
    assert.equal(await resolver.resolve('fxtwitter'), 'https://api.fxtwitter.com/');
    // 共有静的データは既定では未設定 (取得しない)
    assert.equal(await resolver.resolve('sharedData'), '');
});

test('resolve() prefers the setting screen (DB) over config.yml', async () => {
    const resolver = make({
        dbEndpoints: { syobocal: 'https://cache.example.test/syoboi' },
        configDefaults: { syobocal: 'https://config.example.test/syoboi' },
    });

    assert.equal(await resolver.resolve('syobocal'), 'https://cache.example.test/syoboi');
});

test('resolve() uses config.yml when the DB value is absent', async () => {
    const resolver = make({ configDefaults: { annict: 'https://config.example.test/graphql' } });
    assert.equal(await resolver.resolve('annict'), 'https://config.example.test/graphql');
});

test('resolve() treats an empty string as unset and falls through', async () => {
    const resolver = make({
        dbEndpoints: { annict: '   ' },
        configDefaults: { annict: 'https://config.example.test/graphql' },
    });

    assert.equal(await resolver.resolve('annict'), 'https://config.example.test/graphql');
});

test('resolve() rejects non-http(s) or malformed urls and falls back to the default', async () => {
    for (const bad of ['file:///etc/passwd', 'ftp://example.test/x', 'not a url', 'javascript:alert(1)']) {
        const resolver = make({ dbEndpoints: { syobocal: bad } });
        assert.equal(await resolver.resolve('syobocal'), 'https://cal.syoboi.jp/db.php', bad);
    }
});

test('resolve() keeps compatibility with the existing metadataSharedDataUrl config key', async () => {
    const resolver = make({ metadataSharedDataUrl: 'https://example.test/shared.json' });
    assert.equal(await resolver.resolve('sharedData'), 'https://example.test/shared.json');

    // endpoints.sharedData を書いた場合はそちらが優先される
    const overridden = make({
        configDefaults: { sharedData: 'https://cache.example.test/shared.json' },
        metadataSharedDataUrl: 'https://example.test/shared.json',
    });
    assert.equal(await overridden.resolve('sharedData'), 'https://cache.example.test/shared.json');
});

test('resolve() survives a settings lookup failure', async () => {
    const resolver = new MetadataEndpointResolver(
        {
            getAll: async () => {
                throw new Error('db is down');
            },
        },
        { getConfig: () => ({}) },
    );

    assert.equal(await resolver.resolve('annict'), 'https://api.annict.com/graphql');
});

test('getDefaults() exposes the bundled defaults for the settings screen', () => {
    const defaults = make().getDefaults();
    assert.equal(defaults.syobocal, 'https://cal.syoboi.jp/db.php');
    assert.equal(defaults.fxtwitter, 'https://api.fxtwitter.com/');
});
