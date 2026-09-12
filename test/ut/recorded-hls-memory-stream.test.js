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
const RecordedStreamModel = require('../../dist/model/service/stream/RecordedStreamModel').default;
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
    streamModel = RecordedHLSStreamModel,
    hlsMemoryStore = new HLSMemoryStoreModel(logger),
    sourceAnalyzer,
}) {
    const processManager = makeProcessManager();
    const fileDeleter = makeFileDeleter();

    const model = new streamModel(
        makeConfig(streamFilePath),
        logger,
        processManager,
        fileDeleter,
        socketIO,
        makeVideoFileDB(videoFileType),
        recordedDB,
        makeVideoUtil(videoFilePath),
        hlsMemoryStore,
        sourceAnalyzer,
    );

    return { model, processManager, fileDeleter, hlsMemoryStore };
}

test('録画の自動生成 cmd は配信開始時の progressive 素材情報で yadif を除去する', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-deinterlace-'));
        const modelData = makeModel({
            streamFilePath,
            sourceAnalyzer: {
                analyzeRecordedFile: async () => ({
                    codec: 'hevc',
                    scan: 'unknown',
                    fieldOrder: 'unknown',
                    frameRate: 59.94,
                    transport: 'mpegts',
                    hdr: 'sdr',
                    sourceClass: 'generic',
                    confidence: 'high',
                }),
            },
            streamModel: RecordedStreamModel,
        });

        modelData.model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                container: 'm2tsll',
                cmd: '%FFMPEG% -ss %SS% -i %INPUT% -vf %DEINTERLACE%,scale=-2:720 -f mpegts pipe:1',
            },
            0,
        );
        await modelData.model.start(1);

        assert.doesNotMatch(modelData.processManager.calls[0].cmd, /yadif/u);
        assert.match(modelData.processManager.calls[0].cmd, /-vf scale=-2:720/u);

        await modelData.model.stop();
        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

test('TS入力のm2tsllは入力側ID3 mapを使わず出力側Transformへ字幕を渡す', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-m2tsll-'));
        const videoFilePath = path.join(streamFilePath, 'dummy.ts');
        fs.writeFileSync(videoFilePath, Buffer.from('hello-ts-data-without-id3-header'));

        const { model } = makeModel({
            streamFilePath,
            videoFileType: 'ts',
            videoFilePath,
            streamModel: RecordedStreamModel,
        });
        model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                container: 'm2tsll',
                cmd: '%FFMPEG% -i pipe:0 -map 0:v:0 -map 0:a:0 -map 0:s? -c:s copy -f mpegts pipe:1',
            },
            0,
        );

        await model.start(1);

        assert.equal(model.id3MetadataTransoform, null);
        assert.notEqual(model.id3OutputTransform, null);
        assert.equal(model.getStream(), model.id3OutputTransform);

        await model.stop();
        assert.equal(model.id3OutputTransform, null);
        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

test('encodedのm2tsllはTS入力用の出力側ID3 Transformを使わない', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-m2tsll-'));
        const videoFilePath = path.join(streamFilePath, 'dummy.mp4');
        fs.writeFileSync(videoFilePath, Buffer.from('encoded-data'));

        const { model } = makeModel({
            streamFilePath,
            videoFileType: 'encoded',
            videoFilePath,
            streamModel: RecordedStreamModel,
        });
        model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                container: 'm2tsll',
                cmd: '%FFMPEG% -ss %SS% -i %INPUT% -map 0:v:0 -map 0:a:0 -map 0:s? -c:s copy -f mpegts pipe:1',
            },
            0,
        );

        await model.start(1);

        assert.equal(model.id3MetadataTransoform, null);
        assert.equal(model.id3OutputTransform, null);

        await model.stop();
        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

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

test('先行量が数十セグメントまで減ればエンコードを再開する', async () => {
    await withStubbedFfprobe(async () => {
        // MAX_AHEAD_SEGMENT_NUM (150) の 1 セグメント超過 = 停止 100ms
        const { model, processManager, state } = makeThrottleModel(151);

        await model.start(10);
        const stdout = processManager.processes[0].stdout;

        model.throttleEncodeIfTooFarAhead(10);

        assert.equal(model.isEncodeThrottled, true);
        assert.equal(stdout.isPaused(), true);

        // ブラウザが再生して取得位置が進み、先行量が 30 セグメントまで減ったら再開する
        state.aheadNum = 30;
        await new Promise(resolve => setTimeout(resolve, 250));

        assert.equal(model.isEncodeThrottled, false);
        assert.equal(stdout.isPaused(), false);

        await model.stop();
    });
});

test('先行が大きいほど長く止める (超過量に比例、上限 5 秒)', async () => {
    await withStubbedFfprobe(async () => {
        // 150 + 20 超過 = 停止 2000ms
        const { model, processManager, state } = makeThrottleModel(170);

        await model.start(11);
        const stdout = processManager.processes[0].stdout;

        model.throttleEncodeIfTooFarAhead(11);

        assert.equal(model.isEncodeThrottled, true);
        assert.equal(stdout.isPaused(), true);

        // 少し待った程度では再開しない
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.equal(model.isEncodeThrottled, true);
        assert.equal(stdout.isPaused(), true);

        // ブラウザが消費して先行量が 30 セグメントまで減れば再開する
        state.aheadNum = 30;
        await new Promise(resolve => setTimeout(resolve, 2250));
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

// 録画済み in-memory HLS のエンコードは実時間より速く終わるため、再生が終わるより先に
// 必ずエンコーダが終了する。エンコーダの終了をそのままストリーム停止に結びつけると、
// hlsMemoryStore.delete() でまだプレイヤーが取得していない末尾のセグメントまで失われる
// (実測: 9.8 分の録画で 363 秒まで再生できていたのに、エンコーダ終了と同時にストアごと
// 削除され、以後 60 秒経っても再生が戻らなかった)。
// 正常終了 (exit code 0) はストアを残し、異常終了は従来どおり即座に止める

test('in-memory HLS の正常終了 (exit code 0) はストリームを止めず、ストアへ終端だけ記録する', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-hls-'));
        const { model, processManager, hlsMemoryStore } = makeModel({ streamFilePath });

        model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                cmd: '%FFMPEG% -i pipe:0 -movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1',
            },
            0,
        );

        let exited = false;
        model.setExitStream(() => {
            exited = true;
        });

        await model.start(20);
        assert.equal(hlsMemoryStore.has(20), true);

        // まだ再生されていないセグメントが残っている状態を再現する
        hlsMemoryStore.setInit(20, Buffer.from('init'));
        hlsMemoryStore.addSegment(20, Buffer.from('seg0'), 1);

        // ffmpeg が録画末尾まで達して正常終了した状態を模す
        processManager.processes[0].exitCode = 0;
        processManager.processes[0].emit('exit', 0);

        // ストリームは止めない (まだ再生されていないセグメントを失わないため)
        assert.equal(exited, false);
        assert.equal(hlsMemoryStore.has(20), true);
        // プレイリストには終端 (#EXT-X-ENDLIST) が記録され、末尾セグメントはまだ取得できる
        assert.match(hlsMemoryStore.getPlaylist(20), /#EXT-X-ENDLIST/);
        assert.notEqual(hlsMemoryStore.getSegment(20, 0), null);

        // 実際の停止 (クライアント切断 / keep タイマー切れ相当) では従来どおり破棄される
        await model.stop();
        assert.equal(hlsMemoryStore.has(20), false);

        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

test('in-memory HLS の異常終了 (exit code != 0) は従来どおり即座にストリームを止める', async () => {
    await withStubbedFfprobe(async () => {
        const streamFilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-recorded-hls-'));
        const { model, processManager, hlsMemoryStore } = makeModel({ streamFilePath });

        model.setOption(
            {
                videoFileId: 1,
                playPosition: 0,
                cmd: '%FFMPEG% -i pipe:0 -movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1',
            },
            0,
        );

        // exitStream イベントが発行されたか (本番では StreamManageModel がこれを受けて stop() を呼ぶ)
        let exited = false;
        model.setExitStream(() => {
            exited = true;
        });

        await model.start(21);
        assert.equal(hlsMemoryStore.has(21), true);

        processManager.processes[0].exitCode = 1;
        processManager.processes[0].emit('exit', 1);

        // 異常終了は従来どおり即座に exitStream イベントが発行される
        assert.equal(exited, true);

        await model.stop();
        assert.equal(hlsMemoryStore.has(21), false);

        fs.rmSync(streamFilePath, { recursive: true, force: true });
    });
});

// 抑制ログが「pause encode 200ms」なのに実際には MAX_PACE_INTERVAL (5000ms) まで
// 引き延ばされてから再開する不具合があった。先行量 (aheadNum) は視聴の実時間経過でしか
// 減らないため、比例計算した短い pauseTime では RESUME_AHEAD_SEGMENT_NUM (30) まで
// 下がりきらず、ループの上限が MAX_PACE_INTERVAL 固定だった結果、超過量に関わらず
// 常に最大 5 秒まで停止していた。ループの上限は pauseTime 自身にする必要がある
test('先行量が下がらなくても、比例計算した停止時間 (pauseTime) で再開する (MAX_PACE_INTERVAL まで引き延ばされない)', async () => {
    await withStubbedFfprobe(async () => {
        // 150 + 2 超過 = 停止 200ms。テスト中ずっと ahead は 152 のまま (RESUME_AHEAD_SEGMENT_NUM
        // (30) までは実時間経過でしか下がらないため、この短時間では下がらない)
        const { model, processManager } = makeThrottleModel(152);

        await model.start(14);
        const stdout = processManager.processes[0].stdout;

        model.throttleEncodeIfTooFarAhead(14);
        assert.equal(model.isEncodeThrottled, true);

        // pauseTime (200ms) を大きく超えない範囲で再開していることを確認する。
        // 修正前は ahead が下がらない限り MAX_PACE_INTERVAL (5000ms) まで再開しなかった
        await new Promise(resolve => setTimeout(resolve, 350));

        assert.equal(model.isEncodeThrottled, false);
        assert.equal(stdout.isPaused(), false);

        await model.stop();
    });
});
