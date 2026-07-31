'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const registry = require('../../dist/util/ChildProcessRegistry');

/**
 * child_process.ChildProcess の代わり。kill されたことと、終了イベントで登録が外れることを確認する
 */
function stubChild(pid) {
    const child = new EventEmitter();
    child.pid = pid;
    child.killed = false;
    child.signals = [];
    child.kill = signal => {
        child.signals.push(signal);
        child.killed = true;
        return true;
    };
    return child;
}

test('exited children are removed from the registry', () => {
    assert.equal(registry.isShuttingDown(), false);

    const child = stubChild(100);
    registry.registerChildProcess(child);
    child.emit('exit');

    // 登録が外れているので kill は呼ばれない
    registry.killAllChildProcesses();
    assert.deepEqual(child.signals, []);
});

test('killAllChildProcesses stops every registered child and marks shutting down', () => {
    // 前のテストで shuttingDown が立っているため、フラグ以外の振る舞いをここで確認する
    const service = stubChild(200);
    const epgUpdater = stubChild(201);
    registry.registerChildProcess(service);
    registry.registerChildProcess(epgUpdater);

    registry.killAllChildProcesses('SIGINT');

    assert.deepEqual(service.signals, ['SIGINT']);
    assert.deepEqual(epgUpdater.signals, ['SIGINT']);
    assert.equal(registry.isShuttingDown(), true);

    // 一度止めたプロセスは登録から消えるため、二度目の呼び出しで再度 kill されない
    registry.killAllChildProcesses();
    assert.deepEqual(service.signals, ['SIGINT']);
});

test('kill failures of already dead children are ignored', () => {
    const dead = stubChild(300);
    dead.kill = () => {
        throw new Error('ESRCH');
    };
    registry.registerChildProcess(dead);

    assert.doesNotThrow(() => registry.killAllChildProcesses());
});
