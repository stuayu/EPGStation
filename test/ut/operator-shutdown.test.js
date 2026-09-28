'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createOperatorShutdownHandler } = require('../../dist/util/OperatorShutdown');

test('2回目の終了シグナルは graceful shutdown を待たずに exit する', async () => {
    let finishShutdown;
    const exits = [];
    const handler = createOperatorShutdownHandler(
        () => new Promise(resolve => (finishShutdown = resolve)),
        code => exits.push(code),
        () => {},
        1000,
    );
    const first = handler('SIGTERM');
    await handler('SIGINT');
    assert.deepEqual(exits, [1]);
    finishShutdown();
    await first;
    assert.deepEqual(exits, [1, 0]);
});

test('終了処理が上限を超えたら exit code 1 を通知する', async () => {
    const exits = [];
    const handler = createOperatorShutdownHandler(
        () => new Promise(() => {}),
        code => exits.push(code),
        () => {},
        5,
    );
    await handler('SIGTERM');
    assert.deepEqual(exits, [1]);
});
