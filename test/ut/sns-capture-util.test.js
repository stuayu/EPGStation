'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldClaimSnsCapture } = require('../../dist/util/SnsCaptureUtil');

test('SNS 添付パネルが表示中のときだけキャプチャを引き取る', () => {
    assert.equal(shouldClaimSnsCapture(true, 'sns'), true);
    assert.equal(shouldClaimSnsCapture(false, 'sns'), false);
    assert.equal(shouldClaimSnsCapture(true, 'program'), false);
});
