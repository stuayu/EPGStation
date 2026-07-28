'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { compareVersions, isNewerVersion, isPrereleaseVersion, parseVersion } = require('../../dist/util/VersionUtil');

test('parse splits the base version, identifiers and the fork release date', () => {
    const x = parseVersion('2.14.0-stuayu-260727');
    assert.deepEqual(x.base, [2, 14, 0]);
    assert.deepEqual(x.pre, ['stuayu']);
    assert.equal(x.date, 260727);
    assert.equal(x.valid, true);

    // 先頭の v とビルドメタデータは無視する
    const y = parseVersion('v2.14.0+build.5');
    assert.deepEqual(y.base, [2, 14, 0]);
    assert.deepEqual(y.pre, []);
    assert.equal(y.date, null);
});

test('parse rejects values that are not versions', () => {
    assert.equal(parseVersion('').valid, false);
    assert.equal(parseVersion('latest').valid, false);
    assert.equal(parseVersion('1.2.3.4').valid, false);
});

test('base version comparison', () => {
    assert.ok(compareVersions('2.13.1-stuayu-260726', '2.14.0-stuayu-260727') < 0);
    assert.ok(compareVersions('2.14.0-stuayu-260727', '2.13.1-stuayu-260726') > 0);
    assert.equal(compareVersions('2.14.0-stuayu-260727', '2.14.0-stuayu-260727'), 0);
});

test('release date suffix breaks ties within the same base version', () => {
    assert.ok(compareVersions('2.14.0-stuayu-260727', '2.14.0-stuayu-260801') < 0);
});

test('a version without a date suffix is treated as the same release', () => {
    // package.json の version はタグの日付サフィックスを持たないため、
    // これを「古い」と判定してしまうと自分自身への更新を延々と案内してしまう
    assert.equal(compareVersions('2.14.0-stuayu', '2.14.0-stuayu-260727'), 0);
    assert.equal(isNewerVersion('2.14.0-stuayu', '2.14.0-stuayu-260727'), false);
    // ベースが上がっていれば当然「新しい」
    assert.equal(isNewerVersion('2.14.0-stuayu', '2.15.0-stuayu-260801'), true);
});

test('prerelease identifiers sort below the final release', () => {
    assert.ok(compareVersions('2.15.0-rc.1', '2.15.0') < 0);
    assert.ok(compareVersions('2.15.0-beta.2', '2.15.0-rc.1') < 0);
    assert.ok(compareVersions('2.15.0-rc.1', '2.15.0-rc.2') < 0);
});

test('unparseable versions never look like an update', () => {
    assert.equal(compareVersions('unknown', '2.15.0'), 0);
    assert.equal(isNewerVersion('unknown', '2.15.0'), false);
});

test('prerelease detection ignores the fork name', () => {
    assert.equal(isPrereleaseVersion('2.14.0-stuayu-260727'), false);
    assert.equal(isPrereleaseVersion('2.15.0-rc.1'), true);
    assert.equal(isPrereleaseVersion('2.15.0-beta-260801'), true);
    assert.equal(isPrereleaseVersion('2.15.0'), false);
});
