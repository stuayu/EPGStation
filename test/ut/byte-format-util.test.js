'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatBytes } = require('../../dist/util/ByteFormatUtil');

test('オフライン保存の容量表示をKB・MB・GBへ整形する', () => {
    assert.equal(formatBytes(0), '0KB');
    assert.equal(formatBytes(123 * 1024 * 1024), '123.0MB');
    assert.equal(formatBytes(1024 * 1024 * 1024), '1.00GB');
});
