'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { waitForEventOrTimeout } = require('../../dist/util/ScrollPositionWait');

function createEvent() {
    const listeners = new Map();
    return {
        once: (event, listener) => listeners.set(event, listener),
        removeListener: (event, listener) => {
            if (listeners.get(event) === listener) listeners.delete(event);
        },
        emit: event => {
            const listener = listeners.get(event);
            listeners.delete(event);
            if (listener) listener();
        },
        listenerCount: event => (listeners.has(event) ? 1 : 0),
    };
}

test('スクロール復元イベントを受け取ると待機成功を返す', async () => {
    const event = createEvent();
    const waiting = waitForEventOrTimeout(event, 'done', 1000);

    event.emit('done');

    assert.equal(await waiting, true);
    assert.equal(event.listenerCount('done'), 0);
});

test('スクロール復元が遅れても timeout で reject せず待機を終える', async () => {
    const event = createEvent();

    assert.equal(await waitForEventOrTimeout(event, 'done', 10), false);
    assert.equal(event.listenerCount('done'), 0);
});
