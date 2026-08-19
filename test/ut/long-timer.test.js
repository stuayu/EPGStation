'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const LongTimer = require('../../dist/util/LongTimer').default;

// setTimeout が丸めずに扱える上限
const MAX_DELAY = 2147483647;

test('上限以内の遅延はそのまま発火する', async () => {
    const timer = new LongTimer();
    const fired = new Promise(resolve => timer.set(resolve, 10));
    assert.equal(timer.isPending, true);
    await fired;
    assert.equal(timer.isPending, false);
});

test('上限を超える遅延でも即発火せず分割して再武装する', async t => {
    const delays = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (cb, ms) => {
        delays.push(ms);
        // 実際には待たずに次の再武装だけを進める
        return originalSetTimeout(cb, 0);
    };
    t.after(() => {
        global.setTimeout = originalSetTimeout;
    });

    const timer = new LongTimer();
    const delayMs = MAX_DELAY * 2 + 5000;
    const fired = new Promise(resolve => timer.set(resolve, delayMs));
    await fired;

    // 32bit 上限で丸められて 1ms 即発火する経路に入っていないこと
    assert.deepEqual(delays, [MAX_DELAY, MAX_DELAY, 5000]);
});

test('clear すると発火しない', async () => {
    const timer = new LongTimer();
    let fired = false;
    timer.set(() => {
        fired = true;
    }, 5);
    timer.clear();
    assert.equal(timer.isPending, false);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fired, false);
});

test('set し直すと古い待機は破棄される', async () => {
    const timer = new LongTimer();
    const order = [];
    timer.set(() => order.push('old'), 5);
    await new Promise(resolve => {
        timer.set(() => {
            order.push('new');
            resolve();
        }, 10);
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(order, ['new']);
});

test('負値・非数は 0 として扱う', async () => {
    for (const value of [-1000, Number.NaN, Number.POSITIVE_INFINITY]) {
        const timer = new LongTimer();
        await new Promise(resolve => timer.set(resolve, value));
    }
});
