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

function makeModel({
    streamFilePath,
    videoFileType = 'encoded',
    videoFilePath = '/fake/video.mp4',
    hlsMemoryStore = new HLSMemoryStoreModel(logger),
}) {
    const processManager = makeProcessManager();
    const fileDeleter = makeFileDeleter();

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

test('in-memory モードの ts 入力は ID3 変換と AribId3Extractor を経由する (字幕を emsg で配信するため)', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-hls-'));
        const videoFilePath = path.join(streamFilePath, 'dummy.ts');
        fs.writeFileSync(videoFilePath, Buffer.from('hello-ts-data-without-id3-header'));

        const { model } = makeModel({
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

        // mp4 出力には ID3 timed metadata を乗せられないため、エンコード前の TS から ID3 を抜き取り
        // セグメントの emsg box として乗せ直す。そのため 2 つの Transform を経由する
        assert.notEqual(model.id3MetadataTransoform, null);
        assert.notEqual(model.aribId3Extractor, null);

        await model.stop();

        // stop で両方とも破棄する (配信ごとに作り直す)
        assert.equal(model.aribId3Extractor, null);
        assert.equal(model.id3MetadataTransoform, null);

        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

// 再生位置より先行しすぎたエンコードの抑制 (throttle) の検証。
// 完全に止めるとプレイリストの更新も止まり、LL-HLS のプレイヤー (iOS Safari など) が
// ブロッキングプレイリスト要求を出したまま新しいセグメントを取りに来なくなるため、
// クライアントの取得位置が進まず再開もできないデッドロックになる。
// そのため抑制は「超過量に比例した短い停止 → 必ず再開」の比例制御で行う
// (粗い ON/OFF だと再開時にバーストして配信がとびとびになる)。
function makeThrottleModel(aheadNum) {
    const state = { aheadNum: aheadNum };
    const hlsMemoryStore = {
        create: () => {},
        has: () => true,
        setInit: () => {},
        addPart: () => {},
        addSegment: () => {},
        isReady: () => true,
        getPlaylist: () => null,
        waitForPlaylist: async () => null,
        isPlaylistRequestTooOld: () => false,
        getInitSegment: () => null,
        getSegment: () => null,
        getPart: async () => null,
        getAheadSegmentNum: () => state.aheadNum,
        delete: () => {},
    };

    const { model, processManager } = makeModel({ streamFilePath: os.tmpdir(), hlsMemoryStore });

    model.setOption(
        {
            videoFileId: 1,
            playPosition: 0,
            cmd: '%FFMPEG% -i pipe:0 -movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1',
        },
        0,
    );

    return { model, processManager, state };
}

test('先行が少しだけ超えている場合は短く止めるだけで再開する (供給を途切れさせないため)', async () => {
    await withStubbedFfprobe(async () => {
        // MAX_AHEAD_SEGMENT_NUM (150) の 1 セグメント超過 = 停止 100ms
        const { model, processManager, state } = makeThrottleModel(151);

        await model.start(10);
        const stdout = processManager.processes[0].stdout;

        model.throttleEncodeIfTooFarAhead(10);

        assert.equal(model.isEncodeThrottled, true);
        assert.equal(stdout.isPaused(), true);

        // 取得位置が進まなくても (先行量が変わらなくても) 短時間で再開する
        await new Promise(resolve => setTimeout(resolve, 250));

        assert.equal(state.aheadNum, 151);
        assert.equal(model.isEncodeThrottled, false);
        assert.equal(stdout.isPaused(), false);

        await model.stop();
    });
});

test('先行が大きいほど長く止める (超過量に比例、上限 5 秒)', async () => {
    await withStubbedFfprobe(async () => {
        // 150 + 20 超過 = 停止 2000ms
        const { model, processManager } = makeThrottleModel(170);

        await model.start(11);
        const stdout = processManager.processes[0].stdout;

        model.throttleEncodeIfTooFarAhead(11);

        assert.equal(model.isEncodeThrottled, true);
        assert.equal(stdout.isPaused(), true);

        // 少し待った程度では再開しない
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.equal(model.isEncodeThrottled, true);
        assert.equal(stdout.isPaused(), true);

        // 比例分の時間が経てば、先行量が下がっていなくても再開する
        // (止めっぱなしにするとプレイリストの更新が止まりプレイヤーがストールするため)
        await new Promise(resolve => setTimeout(resolve, 1800));
        assert.equal(model.isEncodeThrottled, false);
        assert.equal(stdout.isPaused(), false);

        await model.stop();
    });
});

test('先行が極端に大きくても停止時間は上限で頭打ちになり、必ず再開する', async () => {
    await withStubbedFfprobe(async () => {
        // 超過 1940 セグメント分でも上限の 5000ms で頭打ち
        const { model, processManager } = makeThrottleModel(2000);

        await model.start(13);
        const stdout = processManager.processes[0].stdout;

        model.throttleEncodeIfTooFarAhead(13);

        assert.equal(model.isEncodeThrottled, true);

        await new Promise(resolve => setTimeout(resolve, 5300));

        assert.equal(model.isEncodeThrottled, false);
        assert.equal(stdout.isPaused(), false);

        await model.stop();
    });
});

test('先行量が MAX_AHEAD 以下ならエンコードを止めない', async () => {
    await withStubbedFfprobe(async () => {
        const { model, processManager } = makeThrottleModel(150);

        await model.start(12);
        const stdout = processManager.processes[0].stdout;
        // start 直後は pipe されていないので明示的に流しておく
        stdout.resume();

        model.throttleEncodeIfTooFarAhead(12);

        assert.equal(model.isEncodeThrottled, false);
        assert.equal(stdout.isPaused(), false);

        await model.stop();
    });
});

test('エンコード済みファイル (mp4) は変換を通さず生データがそのまま流れる', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-hls-'));
        const videoFilePath = path.join(streamFilePath, 'dummy.mp4');
        const rawData = Buffer.from('hello-mp4-data');
        fs.writeFileSync(videoFilePath, rawData);

        const { model, processManager } = makeModel({
            streamFilePath,
            videoFileType: 'mp4',
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

        await model.start(4);

        // ARIB 字幕を含まないので変換は挟まない
        assert.equal(model.id3MetadataTransoform, null);
        assert.equal(model.aribId3Extractor, null);

        const proc = processManager.processes[0];
        const received = [];
        proc.stdin.on('data', chunk => received.push(chunk));

        await new Promise(resolve => setTimeout(resolve, 50));

        assert.equal(Buffer.concat(received).toString(), rawData.toString());

        await model.stop();
        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});
