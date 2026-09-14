const test = require('node:test');
const assert = require('node:assert/strict');
const { isNavigationItemEnabled } = require('../../dist/util/NavigationOfflineUtil');

test('オンライン時は遷移先があれば押せる', () => {
    assert.equal(isNavigationItemEnabled({ path: '/recorded' }, false), true);
    assert.equal(isNavigationItemEnabled(null, false), false);
});

test('オフライン時はオフライン保存の画面だけ押せる', () => {
    assert.equal(isNavigationItemEnabled({ path: '/offline-videos' }, true), true);
    assert.equal(isNavigationItemEnabled('/offline-videos/31017-abc', true), true);
    assert.equal(isNavigationItemEnabled({ path: '/recorded' }, true), false);
    assert.equal(isNavigationItemEnabled({ path: '/offline-videos-old' }, true), false);
    assert.equal(isNavigationItemEnabled({}, true), false);
});
