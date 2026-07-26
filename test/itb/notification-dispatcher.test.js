'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { HttpStubServer } = require('../support/HttpStubServer');
const NotificationDispatcher = require('../../dist/model/notification/NotificationDispatcher').default;

function makeQueueDB() {
    const rows = [];
    let nextId = 1;
    return {
        rows,
        enqueue: async value => {
            const row = { id: nextId++, status: 'pending', attempts: 0, lastError: null, ...value };
            rows.push(row);
            return row;
        },
        findDue: async (now, limit) =>
            rows.filter(r => r.status === 'pending' && r.nextAttemptAt <= now).slice(0, limit),
        markSent: async (id, now) => {
            const row = rows.find(r => r.id === id);
            if (row) {
                row.status = 'sent';
                row.updatedAt = now;
            }
        },
        markFailed: async (id, option) => {
            const row = rows.find(r => r.id === id);
            if (row) {
                row.status = option.terminal ? 'failed' : 'pending';
                row.attempts = option.attempts;
                row.nextAttemptAt = option.nextAttemptAt;
                row.lastError = option.lastError;
            }
        },
        listFailed: async () => rows.filter(r => r.status === 'failed'),
    };
}

// 通知配送は永続キューで管理される (Service プロセス再起動をまたいで再送可能)。
// dispatch() の即時配信が失敗した場合はキューに積まれ、processQueue() の呼び出しで
// 指数バックオフに従い再試行され、最終的に成功する
test('notification dispatcher enqueues a failed delivery and processQueue() retries it to success', async t => {
    let attempts = 0;
    const stub = new HttpStubServer((_req, res) => {
        attempts++;
        res.writeHead(attempts === 1 ? 500 : 200);
        res.end();
    });
    const url = await stub.start();
    // アサーション失敗時でもサーバが開いたまま残りテストランナーが終了しなくなるのを防ぐ
    t.after(() => stub.stop());
    const errors = [];
    const config = {
        getConfig: () => ({
            featureFlags: { notifications: true },
            notifications: {
                targets: [{ name: 'test', type: 'webhook', url }],
                maxAttempts: 3,
                allowPrivateNetworkTargets: true,
                baseDelayMs: 1,
                timeoutMs: 1000,
            },
        }),
    };
    const queueDB = makeQueueDB();
    const dispatcher = new NotificationDispatcher(
        config,
        { getLogger: () => ({ system: { error: e => errors.push(e) } }) },
        { getAll: async () => ({}) },
        { isEncrypted: () => false, decrypt: value => value },
        queueDB,
    );

    // 1 回目の即時配信は失敗するのでキューへ積まれる
    await dispatcher.dispatch('recording.started', { name: 'test' });
    assert.equal(attempts, 1);
    assert.equal(queueDB.rows.length, 1);
    assert.equal(queueDB.rows[0].status, 'pending');

    // nextAttemptAt (baseDelayMs=1) を確実に過ぎさせてから再送する (Date.now() の分解能によるレースを防ぐ)
    await new Promise(resolve => setTimeout(resolve, 20));

    // 再送 (2 回目は成功する)
    const result = await dispatcher.processQueue();
    assert.equal(attempts, 2);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(queueDB.rows[0].status, 'sent');
});

test('notification dispatcher is a no-op while disabled', async () => {
    const dispatcher = new NotificationDispatcher(
        { getConfig: () => ({ featureFlags: {} }) },
        {
            getLogger: () => ({
                system: {
                    error: () => {
                        throw new Error('unexpected');
                    },
                },
            }),
        },
        { getAll: async () => ({}) },
        { isEncrypted: () => false, decrypt: value => value },
        makeQueueDB(),
    );
    await dispatcher.dispatch('recording.failed', { name: 'x' });
});

// リトライ上限に達すると failed 履歴として残り、設定画面の失敗履歴取得で参照できる
test('a delivery that exceeds maxAttempts becomes a permanent failure visible via getFailureHistory()', async t => {
    const stub = new HttpStubServer((_req, res) => {
        res.writeHead(500);
        res.end();
    });
    const url = await stub.start();
    // アサーション失敗時でもサーバが開いたまま残りテストランナーが終了しなくなるのを防ぐ
    t.after(() => stub.stop());
    const config = {
        getConfig: () => ({
            featureFlags: { notifications: true },
            notifications: {
                targets: [{ name: 'always-fails', type: 'webhook', url }],
                maxAttempts: 1,
                allowPrivateNetworkTargets: true,
                baseDelayMs: 1,
                timeoutMs: 1000,
            },
        }),
    };
    const queueDB = makeQueueDB();
    const dispatcher = new NotificationDispatcher(
        config,
        { getLogger: () => ({ system: { error: () => {} } }) },
        { getAll: async () => ({}) },
        { isEncrypted: () => false, decrypt: value => value },
        queueDB,
    );
    await dispatcher.dispatch('recording.failed', { name: 'x' });
    // nextAttemptAt (baseDelayMs=1) を確実に過ぎさせてから再送する (Date.now() の分解能によるレースを防ぐ)
    await new Promise(resolve => setTimeout(resolve, 20));
    await dispatcher.processQueue();
    const history = await dispatcher.getFailureHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].targetName, 'always-fails');
});
