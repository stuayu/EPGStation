'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    INITIAL_HLS_OUTPUT_WARNING_DELAY_MS,
    shouldWarnInitialHlsOutput,
} = require('../../dist/util/InitialHlsOutputWarning');

test('最初のセグメントが来た場合は警告しない', () => {
    assert.equal(
        shouldWarnInitialHlsOutput(
            INITIAL_HLS_OUTPUT_WARNING_DELAY_MS,
            0,
            true,
            INITIAL_HLS_OUTPUT_WARNING_DELAY_MS,
        ),
        false,
    );
});

test('初回出力が来ないまま閾値を超えた場合は警告する', () => {
    assert.equal(
        shouldWarnInitialHlsOutput(
            INITIAL_HLS_OUTPUT_WARNING_DELAY_MS,
            0,
            false,
            INITIAL_HLS_OUTPUT_WARNING_DELAY_MS,
        ),
        true,
    );
});

test('閾値に達していなければ警告しない', () => {
    assert.equal(shouldWarnInitialHlsOutput(1000, 0, false, INITIAL_HLS_OUTPUT_WARNING_DELAY_MS), false);
});

test('閾値が 0 以下・時刻が数値でない場合は警告しない', () => {
    assert.equal(shouldWarnInitialHlsOutput(99999, 0, false, 0), false);
    assert.equal(shouldWarnInitialHlsOutput(Number.NaN, 0, false, 1000), false);
});
