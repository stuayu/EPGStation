'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const ProgramReminderScheduler = require('../../dist/model/operator/reminder/ProgramReminderScheduler').default;
const { createProgramStartingPayload } = require('../../dist/model/operator/reminder/ProgramReminderPayload');

const reminder = (id, startAt, minutesBefore = 5) => ({ id, programId: id + 100, channelId: 2, name: `番組${id}`, startAt, minutesBefore });

test('時刻変更時は既存 timer を解除して新しい時刻へ張り直す', () => {
    const timers = new Map();
    let nextId = 0;
    const fired = [];
    const scheduler = new ProgramReminderScheduler({
        setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
    }, item => fired.push(item), () => 1000);
    scheduler.replaceAll([reminder(1, 600_000)]);
    assert.equal(timers.size, 1);
    scheduler.replaceAll([reminder(1, 900_000)]);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 599_000);
    assert.deepEqual(fired, []);
});

test('削除対象と開始時刻を過ぎた番組は timer を残さない', () => {
    const timers = new Map();
    let nextId = 0;
    const scheduler = new ProgramReminderScheduler({
        setTimeout: callback => { const id = ++nextId; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id),
    }, () => {}, () => 1000);
    scheduler.replaceAll([reminder(1, 600_000)]);
    scheduler.replaceAll([]);
    scheduler.replaceAll([reminder(2, 900)]);
    assert.equal(timers.size, 0);
});

test('設定時刻に達したリマインダーを一度だけ通知する', () => {
    let now = 1000;
    let callback;
    const fired = [];
    const scheduler = new ProgramReminderScheduler(
        {
            setTimeout: value => {
                callback = value;
                return 1;
            },
            clearTimeout: () => {},
        },
        item => fired.push(item),
        () => now,
    );
    const item = reminder(3, 301_000, 5);
    scheduler.replaceAll([item]);
    now = 1000;
    callback();
    assert.deepEqual(fired, [item]);
});

test('program.starting payload は通知先共通の番組情報を含む', () => {
    const item = reminder(7, 1_800_000, 10);
    assert.deepEqual(createProgramStartingPayload(item), {
        programId: 107, channelId: 2, name: '番組7', startAt: 1_800_000, minutesBefore: 10,
    });
});
