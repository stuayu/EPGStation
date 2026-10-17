'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const EventSetter = require('../../dist/model/event/EventSetter').default;

const deferred = () => {
    let resolve;
    const promise = new Promise(ok => { resolve = ok; });
    return { promise, resolve };
};

test('failed は thumbnail と failed 通知を行い、finish / encode を行わない', async () => {
    const reservationActions = [];
    let matchingRules = [2, 3];
    let failedHandler;
    let finishHandler;
    let thumbnailCount = 0;
    let finishCommandCount = 0;
    let encodeCount = 0;
    const notices = [];
    let prepFailedHandler;
    const eventStub = new Proxy(
        {},
        {
            get: (_target, key) =>
                key === 'setRecordingFailed'
                    ? callback => {
                          failedHandler = callback;
                      }
                    : key === 'setFinishRecording'
                      ? callback => {
                            finishHandler = callback;
                        }
                      : key === 'setPrepRecordingFailed'
                        ? callback => {
                              prepFailedHandler = callback;
                          }
                        : () => {},
        },
    );
    const logger = { system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} } };
    const config = { getConfig: () => ({ recorded: [] }) };
    const dispatcher = {
        dispatch: async (type, payload) => {
            notices.push({ type, payload });
        },
    };
    const setter = new EventSetter(
        { getLogger: () => logger },
        new Proxy({}, { get: () => () => {} }),
        new Proxy({}, { get: () => () => {} }),
        new Proxy({}, { get: () => () => {} }),
        new Proxy({}, { get: () => () => {} }),
        eventStub,
        new Proxy({}, { get: () => () => {} }),
        new Proxy({}, { get: () => () => {} }),
        new Proxy({}, { get: () => () => {} }),
        {
            cancel: async id => reservationActions.push(['cancel', id]),
            updateRule: async id => reservationActions.push(['updateRule', id]),
            updateRulesByChannelAndShortName: async (channelId, shortName, alwaysRuleIds) => {
                reservationActions.push(['findRules', channelId, shortName, ...(alwaysRuleIds === undefined ? [] : [alwaysRuleIds])]);
                for (const ruleId of new Set([...matchingRules, ...(alwaysRuleIds ?? [])])) {
                    reservationActions.push(['updateRule', ruleId]);
                }
            },
        },
        {},
        {},
        {},
        {
            add: () => {
                thumbnailCount++;
            },
        },
        {
            addRecordingFailedCmd() {},
            addRecordingFinishCmd: () => {
                finishCommandCount++;
            },
            addRecordingPrepRecFailedCmd() {},
        },
        {
            notifyClient() {},
            setEncode: () => {
                encodeCount++;
            },
        },
        config,
        dispatcher,
        { resolve: async () => {} },
        {},
        {},
        {},
        { onChange() {} },
        { findId: async () => ({ name: '放送局' }) },
        { start() {} },
    );
    setter.set();
    const reserve = {
        id: 14,
        name: 'failed recording',
        tags: null,
        encodeMode1: 1,
        encodeMode2: null,
        encodeMode3: null,
    };
    const recorded = { id: 99, videoFiles: [{ id: 101 }] };
    await failedHandler(reserve, recorded);
    assert.equal(thumbnailCount, 1);
    assert.deepEqual(notices, [
        { type: 'recording.failed', payload: { reserveId: 14, recordedId: 99, name: 'failed recording' } },
    ]);
    assert.equal(finishCommandCount, 0);
    assert.equal(encodeCount, 0);
    assert.equal(typeof finishHandler, 'function');

    const manual = {
        ...reserve, ruleId: null, programId: 5, channelId: 8, shortName: '同じ番組',
        isTimeSpecified: false, isEventRelay: false,
    };
    await finishHandler(manual, { id: 100, recordingStatus: 'completed' }, true);
    assert.deepEqual(reservationActions.splice(0), [
        ['cancel', 14], ['findRules', 8, '同じ番組'], ['updateRule', 2], ['updateRule', 3],
    ]);
    await finishHandler({ ...manual, id: 20, ruleId: 1 }, { id: 100, recordingStatus: 'completed' }, true);
    assert.deepEqual(reservationActions.splice(0), [
        ['findRules', 8, '同じ番組', [1]], ['updateRule', 2], ['updateRule', 3], ['updateRule', 1],
    ]);
    matchingRules = [];
    await finishHandler(manual, { id: 100, recordingStatus: 'completed' }, true);
    assert.deepEqual(reservationActions.splice(0), [['cancel', 14], ['findRules', 8, '同じ番組']]);
    for (const excluded of [
        { ...manual, isTimeSpecified: true },
        { ...manual, isEventRelay: true },
        { ...manual, programId: null },
    ]) {
        await finishHandler(excluded, { id: 100, recordingStatus: 'completed' }, true);
        assert.deepEqual(reservationActions.splice(0), [['cancel', 14]]);
    }

    await finishHandler(manual, { id: 100, recordingStatus: 'failed' }, true);
    assert.deepEqual(reservationActions.splice(0), []);

    notices.splice(1);
    await prepFailedHandler({ id: 15, name: '開始前失敗', channelId: 8, startAt: 1234, ruleId: 3 }, 'error', 4);
    assert.deepEqual(notices[1], {
        type: 'recording.startFailed',
        payload: {
            name: '開始前失敗',
            channelName: '放送局',
            startAt: 1234,
            endReason: 'error',
            retryCount: 4,
            reserveId: 15,
            ruleId: 3,
        },
    });
});

test('録画完了後のルール再評価は待たず、失敗したルールの後も継続する', async () => {
    const startedRule3 = deferred();
    const finishRule3 = deferred();
    let finishHandler;
    const logs = [];
    const updates = [];
    const failure = new Error('rule 2 failed');
    let thumbnailCount = 0;
    let encodeCount = 0;
    const eventStub = new Proxy({}, {
        get: (_target, key) => key === 'setFinishRecording'
            ? callback => { finishHandler = callback; }
            : () => {},
    });
    const noop = new Proxy({}, { get: () => () => {} });
    const setter = new EventSetter(
        { getLogger: () => ({ system: { info() {}, debug() {}, warn() {}, fatal() {}, error: value => logs.push(value) } }) },
        noop, noop, noop, noop, eventStub, noop, noop, noop,
        {
            cancel: async () => {},
            updateRule: async ruleId => {
                updates.push(ruleId);
                if (ruleId === 2) throw failure;
                startedRule3.resolve();
                await finishRule3.promise;
            },
            updateRulesByChannelAndShortName: async function () {
                for (const ruleId of [2, 3]) {
                    try {
                        await this.updateRule(ruleId);
                    } catch (err) {
                        logs.push(`recording duplicate reevaluation error. ruleId: ${ruleId}`);
                        logs.push(err);
                    }
                }
            },
        },
        noop, noop, noop,
        { add: () => { thumbnailCount++; } },
        noop,
        { notifyClient() {}, setEncode: () => { encodeCount++; } },
        { getConfig: () => ({ recorded: [{ name: 'recorded' }] }) },
        noop, { resolve: async () => {} }, noop, noop, noop, noop, noop, noop,
    );
    setter.set();

    const manual = {
        id: 14, name: 'manual', ruleId: null, isEventRelay: false, isTimeSpecified: false,
        programId: 5, channelId: 8, shortName: '同じ番組',
        tags: null, encodeMode1: 1, encodeMode2: null, encodeMode3: null,
        encodeParentDirectoryName1: null, encodeDirectory1: null, isDeleteOriginalAfterEncode: false,
    };
    const finishPromise = finishHandler(manual, {
        id: 100, recordingStatus: 'completed', videoFiles: [{ id: 101 }],
    }, true);
    await startedRule3.promise;
    await finishPromise;

    assert.deepEqual(updates, [2, 3]);
    assert.equal(thumbnailCount, 1);
    assert.equal(encodeCount, 1);
    assert.deepEqual(logs, ['recording duplicate reevaluation error. ruleId: 2', failure]);
    finishRule3.resolve();
});
