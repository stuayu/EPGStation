const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createOfflineApiCacheKey,
    createOfflineApiCacheTimeInsensitiveUrl,
    findOfflineApiCacheRecord,
    isOfflineApiCacheAllowed,
    selectOfflineApiCacheEvictions,
    isOfflineMutationBlocked,
} = require('../../dist/util/OfflineApiCacheUtil');

test('offline API cache keys include query and user', () => {
    assert.equal(createOfflineApiCacheKey('./api/schedules?startAt=1', 'alice'), 'alice:./api/schedules?startAt=1');
    assert.notEqual(
        createOfflineApiCacheKey('/api/reserves', 'alice'),
        createOfflineApiCacheKey('/api/reserves', 'bob'),
    );
});

test('時刻クエリを除いた URL で最新レコードを選び、完全一致を優先する', () => {
    const records = [
        { url: '/api/reserves/lists?endAt=1792484170754&startAt=1792480570754&limit=20', savedAt: 10, name: 'old' },
        { url: '/api/reserves/lists?endAt=1792487770754&startAt=1792484170754&limit=20', savedAt: 20, name: 'new' },
    ];

    assert.equal(
        createOfflineApiCacheTimeInsensitiveUrl(
            '/api/reserves/lists?startAt=1792489999999&endAt=1792493599999&limit=20',
        ),
        '/api/reserves/lists?limit=20',
    );
    assert.equal(
        findOfflineApiCacheRecord('/api/reserves/lists?startAt=1792490000000&endAt=1792493600000&limit=20', records)
            .name,
        'new',
    );
    assert.equal(findOfflineApiCacheRecord(records[0].url, records).name, 'old');
});

test('時刻以外のクエリが異なるキャッシュは返さない', () => {
    const records = [{ url: '/api/reserves/lists?startAt=1792480570754&limit=20', savedAt: 10 }];
    assert.equal(findOfflineApiCacheRecord('/api/reserves/lists?startAt=1792484170754&limit=10', records), null);
});

test('offline API cache allowlist matches requested endpoint families only', () => {
    for (const url of [
        '/api/schedules?startAt=1',
        '/api/schedules/broadcasting',
        '/api/reserves/cnts',
        '/api/rules',
        '/api/channels',
        '/api/config',
    ])
        assert.equal(isOfflineApiCacheAllowed(url), true);
    for (const url of ['/api/videos', '/api/auth/status', '/api/reservesX'])
        assert.equal(isOfflineApiCacheAllowed(url), false);
});

test('LRU eviction stays within both byte and item limits', () => {
    const entries = [
        { key: 'old', savedAt: 1, size: 4 },
        { key: 'new', savedAt: 2, size: 4 },
    ];
    assert.deepEqual(selectOfflineApiCacheEvictions(entries, 4, 8, 10), ['old']);
    assert.deepEqual(selectOfflineApiCacheEvictions(entries, 1, 100, 2), ['old']);
});

test('offline mutations are rejected while offline or after cache fallback', () => {
    assert.equal(isOfflineMutationBlocked(true, false), true);
    assert.equal(isOfflineMutationBlocked(false, true), true);
    assert.equal(isOfflineMutationBlocked(false, false), false);
});
