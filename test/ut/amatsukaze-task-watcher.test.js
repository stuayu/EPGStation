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

test('初期キュー一覧を受信するまで待機できる', async () => {
    const { client, watcher } = await createWatcher([], false);
    let resolved = false;
    const snapshot = watcher.waitForInitialQueueSnapshot().then(() => {
        resolved = true;
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, false);

    client.emit('uiData', { queueItems: [] });
    await snapshot;
    assert.equal(resolved, true);
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

// サーバ全体の進捗が取れないときだけ、エンコーダの進捗行 (行頭の [n%]) から拾う
test('エンコード中はコンソール出力の進捗行を進捗にする', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Encoding', consoleId: 1 })] });
    client.emit('consoleUpdate', { index: 1, lines: ['[42.5%] 100/235 frames: 30.00 fps'] });

    const last = updates[updates.length - 1];
    assert.equal(last.percent, 0.425);
    assert.match(last.log, /\[42\.5%\] 100\/235 frames/);
});

// State.Progress はキュー全体の進み具合 (完了したアイテムの割合) で、
// 個々のタスクの進捗ではない。実行中もほとんど動かず値も実態と合わない
test('サーバ全体の進捗 (State.Progress) はタスクの進捗として使わない', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', {
        queueItems: [queueItem({ state: 'Encoding', consoleId: 1 })],
        state: { pause: false, suspend: false, running: true, progress: 0.87 },
    });

    assert.equal(updates[updates.length - 1].percent, 0);

    client.emit('consoleUpdate', { index: 1, lines: ['[12.5%] 100/800 frames'] });
    assert.equal(updates[updates.length - 1].percent, 0.125);
});

// 百分率が出るのはエンコード段階だけ。それ以外は総数が分からない形でしか出ない
test('百分率が出ない段階では直前の進捗を保つ', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Encoding', consoleId: 1 })] });
    client.emit('consoleUpdate', { index: 1, lines: ['[45.0%] 360/800 frames'] });
    assert.equal(updates[updates.length - 1].percent, 0.45);

    // 段階が変わって総数の分からない出力になっても 0% へ戻さない
    client.emit('consoleUpdate', { index: 1, lines: ['1066フレーム完了 125.36fps'] });
    const last = updates[updates.length - 1];
    assert.equal(last.percent, 0.45);
    assert.match(last.log, /1066フレーム完了/);
});

// 進捗行は `[60.7%] ... GPU 21%, VD 58%` の形。行内の他の百分率を拾うと進捗が飛ぶ
test('進捗行以外の百分率 (CPU / GPU 使用率など) は進捗として拾わない', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Encoding', consoleId: 1 })] });
    client.emit('consoleUpdate', {
        index: 1,
        lines: ['[60.7%] 29701/48918 frames: 132.14 fps, 2453 kbps, remain 0:02:25, GPU 21%, VD 58%'],
    });
    assert.equal(updates[updates.length - 1].percent, 0.607);

    // 進捗と無関係な行が後から来ても、そこの百分率は採らない (直前の進捗を保つ)
    client.emit('consoleUpdate', { index: 1, lines: ['encode time 0:04:42, CPU: 10.8%, GPU: 21.6%, VD: 54.7%'] });
    assert.equal(updates[updates.length - 1].percent, 0.607);

    client.emit('consoleUpdate', { index: 1, lines: ['未出力フレーム: 43（0.050%）'] });
    assert.equal(updates[updates.length - 1].percent, 0.607);
});

// 進捗行は改行ではなく CR で同じ行を上書きしていく
test('CR で繋がった進捗はいちばん新しいものを採る', async () => {
    const { client, updates } = await createWatcher();

    client.emit('uiData', { queueItems: [queueItem({ state: 'Encoding', consoleId: 1 })] });
    client.emit('consoleUpdate', {
        index: 1,
        lines: ['[10.0%] 1/10 frames\r[20.0%] 2/10 frames\r[30.5%] 3/10 frames\r'],
    });

    const last = updates[updates.length - 1];
    assert.equal(last.percent, 0.305);
    // 表示も最新の 1 行だけにする (繋がったままだと画面に古い進捗が出続ける)
    assert.match(last.log, /\[30\.5%\] 3\/10 frames$/);
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

// AmatsukazeAddTask の実行中にサーバから Add 通知が届く。投入完了を伝える markTaskAdded() は
// AddTask プロセスの終了後にしか呼べないので、Add 通知の方が先に来る。
// これを「投入前から居たもの」として除外すると、投入したのに永久に見つからなくなる
test('投入完了を伝える前に届いた Add 通知でも自分のタスクとして拾う', async () => {
    const { client, watcher, results, updates } = await createWatcher([], false);

    // start() 直後のキュー全体 (前回失敗した同じ録画のタスクが残っている)
    client.emit('uiData', { queueItems: [queueItem({ id: 5, state: 'Failed' })] });

    // AddTask 実行中に自分のタスクの Add が届く
    client.emit('uiData', { updateType: 'Add', updatedItem: queueItem({ id: 6, state: 'Queue' }) });

    // AddTask プロセスが終わってから投入完了を伝える
    watcher.markTaskAdded();

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
