const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createOfflineApiCacheKey,
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
