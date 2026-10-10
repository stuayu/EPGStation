'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const EventSetter = require('../../dist/model/event/EventSetter').default;

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
};

const createSetter = update => {
    let onUpdated;
    const errors = [];
    const noop = new Proxy({}, { get: () => () => {} });
    const args = Array(26).fill(noop);
    args[0] = { getLogger: () => ({ system: {
        info() {}, debug() {}, warn() {}, fatal() {}, error: error => errors.push(error),
    } }) };
    args[4] = { setUpdated: callback => { onUpdated = callback; } };
    args[10] = { update };
    args[16] = { getConfig: () => ({ recorded: [] }) };
    const setter = new EventSetter(...args);
    setter.set();
    return { setter, onUpdated: diff => onUpdated(diff), errors };
};

test('録画管理の予約差分は前のprovider準備が完了するまで次を開始しない', async () => {
    const first = deferred();
    const started = deferred();
    const calls = [];
    const harness = createSetter(async diff => {
        calls.push(diff);
        if (diff.id === 1) {
            started.resolve();
            await first.promise;
        }
    });
    harness.onUpdated({ id: 1, isOverlap: false });
    await started.promise;
    harness.onUpdated({ id: 2, isOverlap: true });
    await Promise.resolve();
    assert.deepEqual(calls, [{ id: 1, isOverlap: false }]);
    first.resolve();
    await harness.setter.recordingUpdateQueue;
    assert.deepEqual(calls, [{ id: 1, isOverlap: false }, { id: 2, isOverlap: true }]);
});

test('予約差分の適用失敗はログへ記録し、次の差分を続ける', async () => {
    const first = deferred();
    const started = deferred();
    const calls = [];
    const failure = new Error('provider failed');
    const harness = createSetter(async diff => {
        calls.push(diff.id);
        if (diff.id === 1) {
            started.resolve();
            await first.promise;
        }
    });
    harness.onUpdated({ id: 1 });
    await started.promise;
    harness.onUpdated({ id: 2 });
    first.reject(failure);
    await harness.setter.recordingUpdateQueue;
    assert.deepEqual(calls, [1, 2]);
    assert.deepEqual(harness.errors, ['recording reservation update error', failure]);
});
