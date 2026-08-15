'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const AmatsukazeTaskWatcher = require('../../dist/model/amatsukaze/AmatsukazeTaskWatcher').default;

const SRC_PATH = 'D:\\rec\\program.ts';

/**
 * IAmatsukazeRpcClient のスタブ (TCP を張らずにサーバからの push を再現する)
 */
class StubRpcClient extends EventEmitter {
    constructor() {
        super();
        this.requestedCount = 0;
        this.changedItems = [];
    }

    async requestAll() {
        this.requestedCount++;
    }

    async changeItem(itemId, changeType) {
        this.changedItems.push({ itemId, changeType });
    }
}

const queueItem = (override = {}) => ({
    id: 12,
    srcPath: SRC_PATH,
    dstPath: null,
    actualDstPath: null,
    state: 'Queue',
    priority: 3,
    addTime: 1785225000000,
    profileName: 'HEVC',
    eventName: 'テスト番組',
    serviceName: 'テレビ局',
    failReason: null,
    consoleId: 0,
    encodeTimeMs: null,
    ...override,
});

/**
 * 監視を開始した watcher と、そこに流れた更新・結果を集めた入れ物を返す。
 * 実際の呼び出し順は start() → AmatsukazeAddTask → markTaskAdded() なので、
 * 既定では投入済みの状態にしておく (markTaskAdded を呼ぶまで対象は探されない)
 */
const createWatcher = async (pathMappings = [], markTaskAdded = true) => {
    const client = new StubRpcClient();
    const watcher = new AmatsukazeTaskWatcher(client, SRC_PATH, pathMappings, 0);
    const updates = [];
    const results = [];
    const errors = [];

    watcher.on('update', progress => updates.push(progress));
    watcher.on('finish', result => results.push(result));
    watcher.on('error', err => errors.push(err));
    await watcher.start();
    if (markTaskAdded === true) {
        watcher.markTaskAdded();
    }

    return { client, watcher, updates, results, errors };
};

test('キュー一覧から入力ファイルが一致するタスクを見つけて待ち順を出す', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', {
        queueItems: [queueItem({ id: 11, srcPath: 'D:\\rec\\other.ts' }), queueItem({ id: 12, state: 'Queue' })],
    });

    const last = updates[updates.length - 1];
    assert.equal(last.state, 'Queue');
    assert.equal(last.percent, 0);
    assert.match(last.log, /キュー待ち \(2 番目\)/);
    assert.match(last.log, /profile:HEVC/);
});

test('同じ入力ファイルのタスクが複数あるときは追加時刻が新しい方を追跡する', async () => {
    const { client, results } = await createWatcher();

    client.emit('uiData', {
        queueItems: [
            queueItem({ id: 5, addTime: 1785000000000, state: 'Complete', actualDstPath: 'D:\\out\\old.mp4' }),
            queueItem({ id: 12, addTime: 1785225000000, state: 'Encoding' }),
        ],
    });

    // 新しい方 (Encoding) を追跡しているので、まだ完了通知は出ない
    assert.equal(results.length, 0);
});

test('エンコード中はコンソール出力の百分率を進捗にする', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Encoding', consoleId: 1 })] });
    client.emit('consoleUpdate', { index: 1, lines: ['エンコード中 42.5% fps=30'] });

    const last = updates[updates.length - 1];
    assert.equal(last.percent, 0.425);
    assert.match(last.log, /エンコード中 42\.5% fps=30/);
});

test('コンソールから進捗が取れないときはサーバ全体の進捗で代用する', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', {
        queueItems: [queueItem({ state: 'Encoding', consoleId: 1 })],
        state: { pause: false, suspend: false, running: true, progress: 0.6 },
    });

    assert.equal(updates[updates.length - 1].percent, 0.6);
});

test('完了すると出力パスを EPGStation 側のパスへ戻して通知する', async () => {
    const { client, results } = await createWatcher([{ local: '/mnt/out', remote: '\\\\nas\\out' }]);

    client.emit('uiData', {
        queueItems: [
            queueItem({ state: 'Complete', actualDstPath: '\\\\nas\\out\\program.mp4', encodeTimeMs: 65000 }),
        ],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].isSucceeded, true);
    assert.equal(results[0].outputPath, '/mnt/out\\program.mp4');
    assert.equal(results[0].encodeTimeMs, 65000);
});

// Amatsukaze のバージョンによっては完了しても ActualDstPath が返らず、
// 拡張子の付かない DstPath しか得られない (実ファイルは <DstPath>.hevc.ts のように出る)
test('ActualDstPath が無くても DstPath を出力パスのベースとして渡す', async () => {
    const { client, results } = await createWatcher([{ local: '/mnt/out', remote: '\\\\nas\\out' }]);

    client.emit('uiData', {
        queueItems: [
            queueItem({
                state: 'Complete',
                actualDstPath: null,
                dstPath: '\\\\nas\\out\\program',
            }),
        ],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].isSucceeded, true);
    assert.equal(results[0].outputPath, null);
    assert.equal(results[0].outputPathBase, '/mnt/out\\program');
});

test('失敗すると失敗理由付きで通知する', async () => {
    const { client, results } = await createWatcher();

    client.emit('uiData', {
        queueItems: [queueItem({ state: 'Failed', failReason: 'ロゴが見つかりません' })],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].isSucceeded, false);
    assert.equal(results[0].state, 'Failed');
    assert.equal(results[0].failReason, 'ロゴが見つかりません');
});

test('差分更新 (QueueUpdate) でも状態遷移を追える', async () => {
    const { client, updates, results } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'LogoPending' })] });
    assert.match(updates[updates.length - 1].log, /ロゴ・プロファイル待ち/);

    client.emit('uiData', { updateType: 'Update', updatedItem: queueItem({ state: 'Encoding' }) });
    assert.equal(updates[updates.length - 1].state, 'Encoding');

    client.emit('uiData', {
        updateType: 'Update',
        updatedItem: queueItem({ state: 'Complete', actualDstPath: 'D:\\out\\program.mp4' }),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].outputPath, 'D:\\out\\program.mp4');
});

test('キューから削除されたら失敗として扱う', async () => {
    const { client, results } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Queue' })] });
    client.emit('uiData', { updateType: 'Remove', updatedItem: queueItem({ state: 'Queue' }) });

    assert.equal(results.length, 1);
    assert.equal(results[0].isSucceeded, false);
    assert.match(results[0].failReason, /キューからタスクが削除されました/);
});

test('結果は 1 度しか通知されない', async () => {
    const { client, results } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Complete', actualDstPath: 'D:\\out\\a.mp4' })] });
    client.emit('uiData', { queueItems: [queueItem({ state: 'Complete', actualDstPath: 'D:\\out\\a.mp4' })] });

    assert.equal(results.length, 1);
});

test('キャンセルすると追跡中のアイテムに対して Cancel を送る', async () => {
    const { client, watcher } = await createWatcher();

    // 対象が確定する前は何も送らない
    await watcher.cancel();
    assert.equal(client.changedItems.length, 0);

    client.emit('uiData', { queueItems: [queueItem({ state: 'Encoding' })] });
    await watcher.cancel();

    assert.deepEqual(client.changedItems, [{ itemId: 12, changeType: 'Cancel' }]);
});

// Amatsukaze のキューには同じ録画の過去のタスクが残る。投入前のキューから探すと
// それを自分のタスクと取り違え、投入した瞬間に「失敗・キャンセルされた」ことになる
test('投入前からキューに居た同じ入力ファイルのタスクは自分のものとして扱わない', async () => {
    const { client, watcher, results, updates } = await createWatcher([], false);

    // 投入前のキュー: 前回失敗した同じ録画のタスクが残っている
    client.emit('uiData', { queueItems: [queueItem({ id: 5, state: 'Failed', failReason: '前回の失敗' })] });
    assert.equal(results.length, 0);
    assert.equal(updates.length, 0);

    watcher.markTaskAdded();
    assert.equal(results.length, 0);

    // 投入した自分のタスクが現れたらそちらを追う
    client.emit('uiData', {
        updateType: 'Add',
        updatedItem: queueItem({ id: 6, state: 'Queue', addTime: 1785225100000 }),
    });
    assert.equal(results.length, 0);
    assert.equal(updates[updates.length - 1].state, 'Queue');

    client.emit('uiData', {
        updateType: 'Update',
        updatedItem: queueItem({ id: 6, state: 'Complete', actualDstPath: 'D:\\out\\new.mp4' }),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].outputPath, 'D:\\out\\new.mp4');
});

test('投入前に届いた完了・キャンセル通知では終了しない', async () => {
    const { client, results } = await createWatcher([], false);

    client.emit('uiData', { queueItems: [queueItem({ id: 5, state: 'Canceled' })] });
    client.emit('uiData', { updateType: 'Update', updatedItem: queueItem({ id: 5, state: 'Complete' }) });

    assert.equal(results.length, 0);
});

test('投入後に現れたタスクは全体更新からでも拾う', async () => {
    const { client, watcher, updates } = await createWatcher([], false);

    client.emit('uiData', { queueItems: [queueItem({ id: 5, state: 'Canceled' })] });
    watcher.markTaskAdded();
    client.emit('uiData', {
        queueItems: [queueItem({ id: 5, state: 'Canceled' }), queueItem({ id: 6, state: 'Encoding' })],
    });

    assert.equal(updates[updates.length - 1].state, 'Encoding');
});

test('同じ内容の更新は重複して通知しない', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Queue' })] });
    const count = updates.length;
    client.emit('uiData', { queueItems: [queueItem({ state: 'Queue' })] });

    assert.equal(updates.length, count);
});
