'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DEFAULT_RECORDING_RETRY_CONFIG,
    decideRecordingRetry,
    resolveRecordingRetryConfig,
} = require('../../dist/model/operator/recording/RecordingRetryPolicy');

const MINUTE = 60 * 1000;
const config = DEFAULT_RECORDING_RETRY_CONFIG;

test('waiting for a delayed program keeps retrying up to the limit', () => {
    // 前番組が放送時刻未定で延長している間、番組はまだ始まっていない
    const decision = decideRecordingRetry({ reason: 'waitingForEvent', errorRetryCount: 0, waitedMs: 40 * MINUTE, config });
    assert.equal(decision.retry, true);
    assert.equal(decision.delayMs, config.startWaitIntervalMs);
});

test('the wait is given up once the limit is reached', () => {
    const decision = decideRecordingRetry({
        reason: 'waitingForEvent',
        errorRetryCount: 0,
        waitedMs: config.startWaitLimitMs,
        config,
    });
    assert.equal(decision.retry, false);
});

test('the last wait never overshoots the limit', () => {
    // 上限まで残り 20 秒なら 20 秒だけ待つ
    const decision = decideRecordingRetry({
        reason: 'waitingForEvent',
        errorRetryCount: 0,
        waitedMs: config.startWaitLimitMs - 20000,
        config,
    });
    assert.equal(decision.delayMs, 20000);
});

test('waiting for the program does not consume the tuner error budget', () => {
    // 延長待ちを何度繰り返してもエラー回数は増えないため、
    // 実際にチューナー異常が起きたときの再試行回数が残る
    const decision = decideRecordingRetry({
        reason: 'error',
        errorRetryCount: 0,
        waitedMs: 2 * 60 * MINUTE,
        config,
    });
    assert.equal(decision.retry, true);
    assert.equal(decision.delayMs, config.errorFastRetryIntervalMs);
});

test('tuner errors retry fast a few times then slow down and finally give up', () => {
    assert.deepEqual(decideRecordingRetry({ reason: 'error', errorRetryCount: 2, waitedMs: 0, config }), {
        retry: true,
        delayMs: config.errorFastRetryIntervalMs,
    });
    assert.deepEqual(decideRecordingRetry({ reason: 'error', errorRetryCount: 3, waitedMs: 0, config }), {
        retry: true,
        delayMs: config.errorRetryIntervalMs,
    });
    const last = config.errorFastRetryCount + config.errorRetryCount;
    assert.equal(decideRecordingRetry({ reason: 'error', errorRetryCount: last - 1, waitedMs: 0, config }).retry, true);
    assert.equal(decideRecordingRetry({ reason: 'error', errorRetryCount: last, waitedMs: 0, config }).retry, false);
});

test('the default wait covers a long sports overrun', () => {
    // 従来は約 27 分で諦めていた
    assert.equal(config.startWaitLimitMs, 3 * 60 * MINUTE);
    assert.equal(
        decideRecordingRetry({ reason: 'waitingForEvent', errorRetryCount: 0, waitedMs: 90 * MINUTE, config }).retry,
        true,
    );
});

test('settings are read from config and clamped to a sane range', () => {
    const resolved = resolveRecordingRetryConfig({ startWaitLimitMs: 30 * MINUTE, startWaitIntervalMs: 30000 });
    assert.equal(resolved.startWaitLimitMs, 30 * MINUTE);
    assert.equal(resolved.startWaitIntervalMs, 30000);
    // 未指定は既定値
    assert.equal(resolved.firstDataTimeoutMs, config.firstDataTimeoutMs);

    // 範囲外・不正な値は丸める
    assert.equal(resolveRecordingRetryConfig({ startWaitLimitMs: -1 }).startWaitLimitMs, 0);
    assert.equal(
        resolveRecordingRetryConfig({ startWaitLimitMs: 999 * 60 * MINUTE }).startWaitLimitMs,
        24 * 60 * MINUTE,
    );
    assert.equal(resolveRecordingRetryConfig({ startWaitIntervalMs: 1 }).startWaitIntervalMs, 1000);
    assert.equal(resolveRecordingRetryConfig({ firstDataTimeoutMs: 'x' }).firstDataTimeoutMs, config.firstDataTimeoutMs);
    assert.deepEqual(resolveRecordingRetryConfig(undefined), config);
    assert.deepEqual(resolveRecordingRetryConfig(null), config);
});

test('waiting can be disabled to get the previous behaviour', () => {
    const resolved = resolveRecordingRetryConfig({ startWaitLimitMs: 0 });
    assert.equal(
        decideRecordingRetry({ reason: 'waitingForEvent', errorRetryCount: 0, waitedMs: 0, config: resolved }).retry,
        false,
    );
});
