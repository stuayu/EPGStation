'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const EventSetter = require('../../dist/model/event/EventSetter').default;

test('failed は thumbnail と failed 通知を行い、finish / encode を行わない', async () => {
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
        { cancel() {} },
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
        {},
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
