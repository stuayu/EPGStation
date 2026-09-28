'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const PowerManageModel = require('../../dist/model/operator/power/PowerManageModel').default;

const build = ({ reserves = [], fail = false, action = 'standby' } = {}) => {
    const commands = [];
    let timerCallback = null;
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay) => {
        if (delay === 60_000) timerCallback = callback;
        return { unref() {} };
    };
    const config = {
        power: { enabled: true, afterRecording: action, idleMinutes: 10, minGapMinutes: 30, wakeBeforeSec: 300 },
        recording: { prepRecSec: 30 },
    };
    let heavy = false;
    const model = new PowerManageModel(
        { getLogger: () => ({ system: { warn() {}, error() {}, info() {}, debug() {} } }) },
        { getConfig: () => config },
        {
            findAll: async () => [reserves, reserves.length],
            findNextUpcomingForPower: async now =>
                reserves.filter(reserve => reserve.startAt > now).sort((a, b) => a.startAt - b.startAt)[0] ?? null,
        },
        { getPowerCounts: () => ({ recordingCount: 0, recordingPreparationCount: 0 }) },
        {
            setFinishRecording() {},
            setStartPrepRecording() {},
            setStartRecording() {},
            setCancelPrepRecording() {},
            setPrepRecordingFailed() {},
            setRecordingFailed() {},
        },
        { setUpdated() {} },
        {
            getPowerActivity: () => ({
                encodeRunningCount: 0,
                encodeWaitingCount: 0,
                liveStreamCount: 0,
                recordedStreamCount: 0,
                updatedAt: Date.now(),
            }),
            notifyPowerSuspending() {},
        },
        { dispatch: async () => {} },
        {
            run: async (command, args) => {
                commands.push({ command, args });
                if (fail) throw new Error('stub failure');
            },
        },
        { hasRunningJobs: () => heavy },
        { isBusy: () => false },
        { isBusy: () => false },
    );
    model.running = true;
    model.idleSinceAt = Date.now() - 11 * 60_000;
    return {
        model,
        commands,
        setHeavy: value => {
            heavy = value;
        },
        fireTimer: async () => {
            assert.equal(typeof timerCallback, 'function');
            timerCallback();
            await new Promise(resolve => originalSetTimeout(resolve, 0));
        },
        restore: () => {
            global.setTimeout = originalSetTimeout;
        },
    };
};

test('アイドル条件を満たすと休止コマンドを実行する', async t => {
    const state = build();
    t.after(state.restore);
    await state.model.evaluate();
    await state.fireTimer();
    assert.equal(
        state.commands.some(item => item.command === 'systemctl' && item.args[0] === 'suspend'),
        true,
    );
});

test('取消後は稼働状態に戻るまで休止を予約しない', async t => {
    const state = build();
    t.after(state.restore);
    await state.model.evaluate();
    assert.notEqual(state.model.suspendTimer, null);
    state.model.cancel();
    await state.model.evaluate();
    assert.equal(state.model.suspendTimer, null);
    assert.equal(state.model.canceledUntilBusy, true);
});

test('予約更新後にウェイクタイマーを登録する', async t => {
    const reserve = { startAt: Date.now() + 3_600_000, startMarginSec: 60 };
    const state = build({ reserves: [reserve] });
    t.after(state.restore);
    await state.model.refreshWakeTimer();
    reserve.startAt += 120_000;
    await state.model.refreshWakeTimer();
    assert.equal(state.commands[0].command, 'rtcwake');
    assert.equal(state.commands.length, 2);
    assert.equal(state.commands[0].args[0], '-m');
});

test('次の復帰時刻は録画タイミング共通設定の準備・開始マージンを含む', async t => {
    const startAt = Date.now() + 3_600_000;
    const reserve = { startAt, startMarginSec: null };
    const state = build({ reserves: [reserve] });
    t.after(state.restore);
    await state.model.refreshWakeTimer();
    assert.equal(Number(state.commands[0].args[3]), Math.ceil((startAt - 335_000) / 1000));
});

test('ウェイク登録失敗時は休止を予約しない', async t => {
    const reserve = { startAt: Date.now() + 3_600_000, startMarginSec: 0 };
    const state = build({ reserves: [reserve], fail: true });
    t.after(state.restore);
    await state.model.evaluate();
    assert.equal(state.model.suspendTimer, null);
});

test('休止予約後に近い録画予約が追加されたら休止タイマーを取り消す', async t => {
    const reserves = [];
    const state = build({ reserves });
    t.after(state.restore);
    await state.model.evaluate();
    assert.notEqual(state.model.suspendTimer, null);
    reserves.push({ startAt: Date.now() + 3 * 60_000, startMarginSec: 0 });
    await state.model.evaluate();
    assert.equal(state.model.suspendTimer, null);
});

test('休止タイマー満了時に重い処理が始まっていたら休止コマンドを出さない', async t => {
    const state = build();
    t.after(state.restore);
    await state.model.evaluate();
    state.setHeavy(true);
    await state.fireTimer();
    assert.equal(
        state.commands.some(item => item.args[0] === 'suspend'),
        false,
    );
});
