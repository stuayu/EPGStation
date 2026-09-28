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
    const eventStub = new Proxy({}, { get: (_target, key) => key === 'setRecordingFailed'
        ? callback => { failedHandler = callback; }
        : key === 'setFinishRecording' ? callback => { finishHandler = callback; }
            : () => {} });
    const logger = { system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} } };
    const config = { getConfig: () => ({ recorded: [] }) };
    const dispatcher = { dispatch: async type => { notices.push(type); } };
    const setter = new EventSetter(
        { getLogger: () => logger },
        new Proxy({}, { get: () => () => {} }), new Proxy({}, { get: () => () => {} }),
        new Proxy({}, { get: () => () => {} }), new Proxy({}, { get: () => () => {} }), eventStub,
        new Proxy({}, { get: () => () => {} }), new Proxy({}, { get: () => () => {} }),
        new Proxy({}, { get: () => () => {} }), {}, {}, {}, {},
        { add: () => { thumbnailCount++; } },
        { addRecordingFailedCmd() {}, addRecordingFinishCmd: () => { finishCommandCount++; } },
        { notifyClient() {}, setEncode: () => { encodeCount++; } }, config, dispatcher, {}, {}, {}, {}, { onChange() {} },
    );
    setter.set();
    const reserve = { id: 14, name: 'failed recording', tags: null, encodeMode1: 1, encodeMode2: null, encodeMode3: null };
    const recorded = { id: 99, videoFiles: [{ id: 101 }] };
    await failedHandler(reserve, recorded);
    assert.equal(thumbnailCount, 1);
    assert.deepEqual(notices, ['recording.failed']);
    assert.equal(finishCommandCount, 0);
    assert.equal(encodeCount, 0);
    assert.equal(typeof finishHandler, 'function');
});
