'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    formatLogTime,
    formatTimeChange,
    formatLogDuration,
    formatDurationUndefinedChange,
} = require('../../dist/util/ProgramTimeLog');

const BASE = new Date(2026, 7, 1, 12, 0, 0).getTime();

test('formatLogTime formats a unixtime', () => {
    assert.equal(formatLogTime(BASE), '2026/08/01 12:00:00');
});

test('formatLogTime falls back for a missing time', () => {
    assert.equal(formatLogTime(null), 'unknown');
    assert.equal(formatLogTime(undefined), 'unknown');
});

test('formatTimeChange shows before and after with the difference', () => {
    assert.equal(
        formatTimeChange(BASE, BASE + 5 * 60 * 1000),
        '2026/08/01 12:00:00 -> 2026/08/01 12:05:00 (+300s)',
    );
});

test('formatTimeChange marks a negative shift', () => {
    assert.equal(
        formatTimeChange(BASE, BASE - 60 * 1000),
        '2026/08/01 12:00:00 -> 2026/08/01 11:59:00 (-60s)',
    );
});

test('formatTimeChange says no change when the time is the same', () => {
    assert.equal(formatTimeChange(BASE, BASE), '2026/08/01 12:00:00 (no change)');
});

test('formatTimeChange shows only the new time when the old one is unknown', () => {
    assert.equal(formatTimeChange(null, BASE), '2026/08/01 12:00:00');
});

test('formatLogDuration marks an undefined duration', () => {
    // Mirakurun は ARIB の 0xFFFFFF を duration: 1 で返す
    assert.equal(formatLogDuration(1), 'undefined (pending)');
    assert.equal(formatLogDuration(30 * 60 * 1000), '1800s');
});

test('formatDurationUndefinedChange reports the transition', () => {
    assert.equal(formatDurationUndefinedChange(30 * 60 * 1000, 1), 'end time became pending');
    assert.equal(formatDurationUndefinedChange(1, 30 * 60 * 1000), 'end time has been fixed');
    assert.equal(formatDurationUndefinedChange(1, 1), 'end time is still pending');
    assert.equal(formatDurationUndefinedChange(30 * 60 * 1000, 30 * 60 * 1000), null);
});

test('formatDurationUndefinedChange handles an unknown previous duration', () => {
    assert.equal(formatDurationUndefinedChange(null, 1), 'end time is pending');
    assert.equal(formatDurationUndefinedChange(null, 30 * 60 * 1000), null);
});
