'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const VirtualTimelineListenerController = require('../../dist/util/VirtualTimelineListenerController').default;

test('VirtualTimeline の再接続後も描画 listener は 1 個だけになる', () => {
    let activeListeners = 0;
    const controller = new VirtualTimelineListenerController(
        () => {
            activeListeners += 1;
        },
        () => {
            activeListeners -= 1;
        },
    );

    controller.attach();
    controller.attach();
    controller.reattach();
    controller.reattach();

    assert.equal(activeListeners, 1);
    assert.equal(controller.isAttached(), true);

    controller.detach();
    controller.detach();
    assert.equal(activeListeners, 0);
    assert.equal(controller.isAttached(), false);
});

test('未接続状態の再接続は listener を 1 個だけ接続する', () => {
    let attachCount = 0;
    const controller = new VirtualTimelineListenerController(
        () => {
            attachCount += 1;
        },
        () => {},
    );

    controller.reattach();
    controller.reattach();

    assert.equal(attachCount, 2);
    assert.equal(controller.isAttached(), true);
});
