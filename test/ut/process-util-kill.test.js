'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const EventEmitter = require('node:events');
const ProcessUtil = require('../../dist/util/ProcessUtil').default;
const AmatsukazeCancelController = require('../../dist/model/amatsukaze/AmatsukazeCancelController').default;

test('停止要求は投入後に一度だけ cancel する', () => {
    let cancels = 0;
    const controller = new AmatsukazeCancelController(() => cancels++);
    controller.taskAdded();
    controller.request();
    controller.request();
    assert.equal(cancels, 1);
});

test('投入前の停止要求は投入完了時に cancel する', () => {
    let cancels = 0;
    const controller = new AmatsukazeCancelController(() => cancels++);
    controller.request();
    assert.equal(cancels, 0);
    controller.taskAdded();
    assert.equal(cancels, 1);
});

test('完了後の停止要求は cancel しない', () => {
    let cancels = 0;
    const controller = new AmatsukazeCancelController(() => cancels++);
    controller.taskAdded();
    controller.finish();
    controller.request();
    assert.equal(cancels, 0);
});

const createChild = () => {
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stdout = null;
    child.stderr = null;
    child.kills = 0;
    child.kill = () => {
        child.kills += 1;
        return true;
    };
    return child;
};

test('ProcessUtil.kill は子が先に exit したらすぐ resolve し、kill しない', async () => {
    const child = createChild();
    const started = Date.now();
    const killed = ProcessUtil.kill(child, 0, 500);
    child.emit('exit', 0, null);
    await killed;
    assert.ok(Date.now() - started < 100);
    assert.equal(child.kills, 0);
});

test('ProcessUtil.kill は猶予時間後も子が残れば kill する', async () => {
    const child = createChild();
    await ProcessUtil.kill(child, 0, 20);
    assert.equal(child.kills, 1);
});
