'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const RecordedHLSStreamModel = require('../../dist/model/service/stream/RecordedHLSStreamModel').default;
const HLSMemoryStoreModel = require('../../dist/model/service/stream/util/HLSMemoryStoreModel').default;

// 録画済み HLS 配信の in-memory / ディスク方式の切り替えを検証するテスト。
// isMemoryHLS() は cmd に %streamFileDir% を含むかどうかで判定される (ライブ HLS と同じ規則)。

const logger = {
    getLogger: () => ({
        stream: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
        system: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    }),
};

function makeConfig(streamFilePath) {
    return {
        getConfig: () => ({
            ffmpeg: 'ffmpeg',
            ffprobe: 'ffprobe',
            streamFilePath: streamFilePath,
        }),
    };
}

function makeFakeChildProcess() {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.exitCode = null;
    proc.kill = () => {
        proc.exitCode = 0;
    };

    return proc;
}

function makeProcessManager() {
    const calls = [];
    const processes = [];

    return {
        calls,
        processes,
        create: async option => {
            calls.push(option);
            const proc = makeFakeChildProcess();
            processes.push(proc);

            return proc;
        },
    };
}

function makeFileDeleter() {
    const calls = [];

    return {
        calls,
        setOption: () => {},
        deleteAllFiles: async () => {
            calls.push('deleteAllFiles');
        },
    };
}

function makeVideoFileDB(videoFileType) {
    return {
        findId: async id => ({ id, recordedId: 1, type: videoFileType }),
    };
}

const recordedDB = {
    findId: async id => ({ id, isRecording: false }),
};

function makeVideoUtil(filePath) {
    return {
        getFullFilePathFromId: async () => filePath,
    };
}

const socketIO = { notifyClient: () => {} };

function withStubbedFfprobe(fn) {
    const original = cp.exec;
    cp.exec = (_cmd, cb) => {
        cb(
            null,
            JSON.stringify({
                format: { duration: '600.0', size: '1000000', bit_rate: '800000' },
            }),
        );
    };

    return fn().finally(() => {
        cp.exec = original;
    });
}

function makeModel({ streamFilePath, videoFileType = 'encoded', videoFilePath = '/fake/video.mp4' }) {
    const processManager = makeProcessManager();
    const fileDeleter = makeFileDeleter();
    const hlsMemoryStore = new HLSMemoryStoreModel(logger);

    const model = new RecordedHLSStreamModel(
        makeConfig(streamFilePath),
        logger,
        processManager,
        fileDeleter,
        socketIO,
        makeVideoFileDB(videoFileType),
        recordedDB,
        makeVideoUtil(videoFilePath),
        hlsMemoryStore,
    );

    return { model, processManager, fileDeleter, hlsMemoryStore };
}

test('cmd に %streamFileDir% を含まない場合は in-memory モードで配信し、ディスクを使わない', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-hls-'));
        const { model, processManager, fileDeleter, hlsMemoryStore } = makeModel({ streamFilePath });

        model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                cmd: '%FFMPEG% -i pipe:0 -movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1',
            },
            0,
        );

        await model.start(1);

        // エンコードプロセスの output は null (ディスクへ書き出さない)
        assert.equal(processManager.calls.length, 1);
        assert.equal(processManager.calls[0].output, null);

        // メモリストアにエントリが作成されている
        assert.equal(hlsMemoryStore.has(1), true);

        // ストリームディレクトリの準備 (prepStreamDir) は行われないため streamFilePath 自体は
        // 事前に作成した空ディレクトリのまま何も書き込まれない
        assert.deepEqual(fs.readdirSync(streamFilePath), []);

        await model.stop();

        // stop 時にメモリストアのエントリが破棄され、ディスク方式の fileDeleter は呼ばれない
        assert.equal(hlsMemoryStore.has(1), false);
        assert.equal(fileDeleter.calls.length, 0);

        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

test('cmd に %streamFileDir% を含む場合は従来どおりディスク方式で配信する', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-hls-'));
        const { model, processManager, fileDeleter, hlsMemoryStore } = makeModel({ streamFilePath });

        model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                cmd:
                    '%FFMPEG% -i pipe:0 -f hls -hls_time 1 -hls_list_size 0 -hls_flags delete_segments ' +
                    '-hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts %OUTPUT%',
            },
            0,
        );

        await model.start(2);

        assert.equal(processManager.calls.length, 1);
        const created = processManager.calls[0];
        assert.equal(created.output, `${streamFilePath}/stream2.m3u8`);
        // %streamFileDir% / %streamNum% が cmd 内で実際のパスへ置換されている
        assert.ok(created.cmd.includes(`${streamFilePath}/stream2-%09d.ts`));
        assert.equal(created.cmd.includes('%streamFileDir%'), false);

        // ディスク方式なのでメモリストアは使われない
        assert.equal(hlsMemoryStore.has(2), false);

        await model.stop();

        // stop 時にディスク方式の fileDeleter が呼ばれる
        assert.ok(fileDeleter.calls.includes('deleteAllFiles'));

        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

test('in-memory モードでは ts 入力でも arib-subtitle-timedmetadater を通さず生データがそのまま流れる', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-hls-'));
        const videoFilePath = path.join(streamFilePath, 'dummy.ts');
        const rawData = Buffer.from('hello-ts-data-without-id3-header');
        fs.writeFileSync(videoFilePath, rawData);

        const { model, processManager } = makeModel({
            streamFilePath,
            videoFileType: 'ts',
            videoFilePath,
        });

        model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                cmd: '%FFMPEG% -i pipe:0 -movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1',
            },
            0,
        );

        await model.start(3);

        const proc = processManager.processes[0];
        const received = [];
        proc.stdin.on('data', chunk => received.push(chunk));

        await new Promise(resolve => setTimeout(resolve, 50));

        const receivedBuf = Buffer.concat(received);
        assert.equal(receivedBuf.toString(), rawData.toString());

        await model.stop();
        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});
