'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const EncodeFinishModel = require('../../dist/model/service/encode/EncodeFinishModel').default;

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        encode: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }),
};

function createFakes() {
    const addVideoFileCalls = [];
    const emitFinishEncodeCalls = [];

    const socket = {
        notifyClient: () => {},
        notifyUpdateEncodeProgress: () => {},
    };

    const ipc = {
        recorded: {
            addVideoFile: async option => {
                addVideoFileCalls.push(option);
                return 100;
            },
            deleteVideoFile: async () => {},
            updateVideoFileSize: async () => {},
        },
        encodeEvent: {
            emitFinishEncode: async info => {
                emitFinishEncodeCalls.push(info);
            },
        },
    };

    // set() が呼ぶコールバック登録を横取りするだけの簡易 IEncodeEvent
    let finishEncodeCallback = null;
    const encodeEvent = {
        setAddEncode: () => {},
        setCancelEncode: () => {},
        setFinishEncode: cb => {
            finishEncodeCallback = cb;
        },
        setErrorEncode: () => {},
        setUpdateEncodeProgress: () => {},
    };

    return { addVideoFileCalls, emitFinishEncodeCalls, socket, ipc, encodeEvent, getFinishEncodeCallback: () => finishEncodeCallback };
}

function baseInfo(overrides) {
    return Object.assign(
        {
            recordedId: 1,
            videoFileId: 10,
            parentDirName: 'encode',
            filePath: 'output.mp4',
            fullOutputPath: '/data/encode/output.mp4',
            mode: 'H.264',
            removeOriginal: false,
        },
        overrides,
    );
}

// video_file.type はストリーミングパイプライン選択 (StreamProfileManageModel.getRecordedProfiles /
// StreamApiModel) にも使われるため、拡張子に関わらずエンコード出力は常に 'encoded' として登録する。
// tsreplace 系 (.hevc.ts のように出力拡張子が .ts のまま) であっても、実体はシーク可能な
// 処理済みファイルなので 'ts' (生の放送 TS 前提のパイプ入力パイプライン) にしてはいけない。
// TS 解析 (PSI/SI) の対象判定は type ではなく拡張子で別途行う (VideoFileAnalyzeModel を参照)
test('tsreplace 系 (.ts 拡張子のまま) の出力も type: encoded として登録される', async () => {
    const fakes = createFakes();
    const model = new EncodeFinishModel(logger, fakes.socket, fakes.ipc, fakes.encodeEvent);
    model.set();

    await fakes.getFinishEncodeCallback()(baseInfo({ filePath: 'output.hevc.ts' }));

    assert.equal(fakes.addVideoFileCalls.length, 1);
    assert.equal(fakes.addVideoFileCalls[0].type, 'encoded');
});

test('完全な再マルチプレクス (.mp4) の出力も type: encoded として登録される', async () => {
    const fakes = createFakes();
    const model = new EncodeFinishModel(logger, fakes.socket, fakes.ipc, fakes.encodeEvent);
    model.set();

    await fakes.getFinishEncodeCallback()(baseInfo({ filePath: 'output.mp4' }));

    assert.equal(fakes.addVideoFileCalls.length, 1);
    assert.equal(fakes.addVideoFileCalls[0].type, 'encoded');
});

test('.mkv の出力も type: encoded として登録される', async () => {
    const fakes = createFakes();
    const model = new EncodeFinishModel(logger, fakes.socket, fakes.ipc, fakes.encodeEvent);
    model.set();

    await fakes.getFinishEncodeCallback()(baseInfo({ filePath: 'output.mkv' }));

    assert.equal(fakes.addVideoFileCalls.length, 1);
    assert.equal(fakes.addVideoFileCalls[0].type, 'encoded');
});

test('fullOutputPath が null (ファイルサイズ更新のみ) の場合は addVideoFile を呼ばない', async () => {
    const fakes = createFakes();
    const model = new EncodeFinishModel(logger, fakes.socket, fakes.ipc, fakes.encodeEvent);
    model.set();

    await fakes.getFinishEncodeCallback()(baseInfo({ fullOutputPath: null, filePath: null }));

    assert.equal(fakes.addVideoFileCalls.length, 0);
});
