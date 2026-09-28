'use strict';

const assert = require('node:assert/strict');
const { PassThrough, Readable, Writable } = require('node:stream');
const test = require('node:test');
const RecordingSink = require('../../dist/model/operator/recording/RecordingSink').default;
const RecordingUpstreamSession = require('../../dist/model/operator/recording/RecordingUpstreamSession').default;
const endPolicy = require('../../dist/model/operator/recording/RecordingStreamEndPolicy');

const packets = (count, connection = 1) => {
    const data = Buffer.alloc(count * 188, 0xff);
    for (let i = 0; i < count; i++) {
        const packet = data.subarray(i * 188, (i + 1) * 188);
        packet[0] = 0x47;
        packet[1] = 0x01;
        packet[2] = 0x00;
        packet[3] = 0x10 | (i & 0x0f);
        packet.writeUInt32BE(connection, 4);
        packet.writeUInt32BE(i, 8);
    }
    return data;
};

const makeOptions = (overrides = {}) => ({
    creator: {
        getCloseReason: () => null,
        closeStream: (source, reason) => {
            source.closeReason = reason;
            source.destroy();
        },
        reconnect: async () => { throw new Error('unexpected reconnect'); },
    },
    reserve: { id: 1 },
    sink: null,
    deadline: () => Date.now() + 60_000,
    managedEnd: true,
    reconnectEnabled: true,
    isCurrent: () => true,
    boundaryDecided: () => false,
    onAttemptStart: async () => {},
    onAttemptEnd: async () => {},
    onChunk: () => {},
    onFirstData: async () => {},
    onReconnectState: () => {},
    onGapStart: () => {},
    onGapEnd: () => {},
    onWriteError: () => {},
    ...overrides,
});

test('再接続では部分 TS を捨て、同じ sink に complete packet だけ追記する', async () => {
    const originalBackoff = [...endPolicy.BACKOFF_MS];
    endPolicy.BACKOFF_MS[0] = 1;
    endPolicy.BACKOFF_MS[1] = 1;
    const file = new PassThrough();
    const saved = [];
    file.on('data', chunk => saved.push(chunk));
    const sink = new RecordingSink(file, new PassThrough());
    const first = new PassThrough();
    const second = Readable.from([packets(3, 2)]);
    second.closeReason = 'scheduled-end';
    const attemptOffsets = [];
    let connects = 0;
    const creator = {
        getCloseReason: source => source.closeReason ?? null,
        closeStream: (source, reason) => {
            source.closeReason = reason;
            source.destroy();
        },
        reconnect: async () => {
            connects++;
            return second;
        },
    };
    const session = new RecordingUpstreamSession(
        makeOptions({
            creator,
            sink,
            deadline: () => Date.now() + 15,
            onAttemptStart: async offset => attemptOffsets.push(offset),
        }),
    );
    const running = session.run(first);
    first.write(Buffer.concat([packets(3), Buffer.alloc(73, 0x47)]));
    const error = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    setImmediate(() => first.destroy(error));
    const decision = await running;
    await sink.finish();
    endPolicy.BACKOFF_MS.splice(0, endPolicy.BACKOFF_MS.length, ...originalBackoff);

    const output = Buffer.concat(saved);
    assert.equal(decision, 'scheduled-end');
    assert.equal(connects, 1);
    assert.deepEqual(attemptOffsets, [3 * 188]);
    assert.equal(output.length, 6 * 188);
    assert.equal(output.length % 188, 0);
    for (let offset = 0; offset < output.length; offset += 188) assert.equal(output[offset], 0x47);
    assert.equal(output.readUInt32BE(3 * 188 + 4), 2);
});

test('遅い write先が backpressure を返すと source pause し drain 後に resume する', async t => {
    const count = 2000;
    let writtenBytes = 0;
    const slowFile = new Writable({
        highWaterMark: 1,
        write(chunk, encoding, callback) {
            writtenBytes += chunk.length;
            setTimeout(callback, 1);
        },
    });
    const sink = new RecordingSink(slowFile, new PassThrough({ highWaterMark: 1024 }));
    const source = Readable.from(
        (async function* () {
            for (let i = 0; i < count / 5; i++) yield packets(5);
        })(),
    );
    let pauseCount = 0;
    let resumeCount = 0;
    const originalPause = source.pause.bind(source);
    const originalResume = source.resume.bind(source);
    source.pause = () => { pauseCount++; return originalPause(); };
    source.resume = () => { resumeCount++; return originalResume(); };
    const session = new RecordingUpstreamSession(
        makeOptions({
            sink,
            reconnectEnabled: false,
            deadline: () => Date.now() + 60_000,
        }),
    );
    const running = session.run(source);
    const highWaterMarks = { source: 0, passThrough: 0, file: 0 };
    const sampler = setInterval(() => {
        highWaterMarks.source = Math.max(highWaterMarks.source, source.readableLength);
        highWaterMarks.passThrough = Math.max(highWaterMarks.passThrough, sink.passThrough.writableLength);
        highWaterMarks.file = Math.max(highWaterMarks.file, slowFile.writableLength);
    }, 1);
    const decision = await running;
    clearInterval(sampler);
    await sink.finish();

    assert.equal(decision, 'stream-ended');
    assert.ok(pauseCount > 0, `source pause calls=${pauseCount}`);
    assert.ok(resumeCount > 1, `source resume calls=${resumeCount}`);
    assert.equal(writtenBytes, count * 188);
    assert.ok(highWaterMarks.source <= 20 * 1024, `source queued ${highWaterMarks.source} bytes`);
    assert.ok(highWaterMarks.passThrough <= 2 * 1024, `sink queued ${highWaterMarks.passThrough} bytes`);
    t.diagnostic(JSON.stringify({ writtenBytes, highWaterMarks, pauseCount, resumeCount }));
});
