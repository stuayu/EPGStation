'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ProgramReminderManageModel = require('../../dist/model/operator/reminder/ProgramReminderManageModel').default;

test('発火と同時に進行中の refresh が終わっても同じ通知を再登録しない', async () => {
    const originalNow = Date.now;
    Date.now = () => 1_000;
    let model;
    try {
        const reminder = {
            id: 7,
            programId: 99,
            userId: null,
            channelId: 5,
            name: '番組',
            startAt: 600_000,
            minutesBefore: 1,
        };
        let stored = [reminder];
        let releaseFindIds;
        let enteredFindIds;
        const findIdsEntered = new Promise(resolve => {
            enteredFindIds = resolve;
        });
        const program = { id: 99, channelId: 5, name: '番組', startAt: 600_000 };
        const reminderDB = {
            findAll: async () => stored,
            delete: async id => {
                stored = stored.filter(item => item.id !== id);
            },
            update: async () => {},
        };
        const programDB = {
            findIds: async ids => {
                if (ids.length === 0) return [];
                enteredFindIds();
                return new Promise(resolve => {
                    releaseFindIds = () => resolve([program]);
                });
            },
            findId: async () => program,
        };
        let notifications = 0;
        model = new ProgramReminderManageModel(
            { getLogger: () => ({ system: { error() {} } }) },
            { setProgramUpdated() {}, setOnAirProgramUpdated() {} },
            reminderDB,
            programDB,
            {
                dispatch: async () => {
                    notifications++;
                },
            },
            { notifyProgramStartingClient() {} },
        );
        const refresh = model.refresh();
        const reachedBatchLookup = await Promise.race([
            findIdsEntered.then(() => true),
            new Promise(resolve => setTimeout(() => resolve(false), 100)),
        ]);
        assert.equal(reachedBatchLookup, true);
        await model.fire(reminder);
        releaseFindIds();
        await refresh;
        assert.equal(notifications, 1);
        assert.deepEqual(stored, []);
    } finally {
        model?.scheduler?.clear();
        Date.now = originalNow;
    }
});
