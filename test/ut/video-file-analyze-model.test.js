'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const VideoFileAnalyzeModel = require('../../dist/model/video/VideoFileAnalyzeModel').default;

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }),
};

function emptyTsInfo(override) {
    return Object.assign(
        {
            networkId: null,
            transportStreamId: null,
            serviceId: null,
            serviceType: null,
            serviceName: null,
            serviceProviderName: null,
            networkName: null,
            eventId: null,
            eventName: null,
            eventDescription: null,
            eventExtended: null,
            eventStartAt: null,
            eventDuration: null,
            genres: [],
            videoStreamType: null,
            videoPid: null,
            audioStreamType: null,
            audioPid: null,
            firstTdtAt: null,
        },
        override,
    );
}

function createModel(options) {
    const opt = options || {};
    const upserted = [];
    const startAtUpdated = [];
    const video = Object.assign({ id: 1, recordedId: 10, type: 'ts', size: 100, startAt: null }, opt.video);

    const videoFileDB = {
        findId: async id => (id === video.id ? video : null),
        updateMetadata: async () => {},
        updateStartAt: async (id, startAt) => startAtUpdated.push({ id, startAt }),
    };
    const videoFileTsInfoDB = {
        upsert: async info => upserted.push(info),
        findId: async () => opt.storedTsInfo ?? null,
    };
    const recordedDB = { findId: async () => opt.recorded ?? null };
    const videoUtil = {
        getFullFilePathFromVideoFile: () => opt.filePath ?? '/tmp/epgstation-not-exists.ts',
        getDetailedInfo: async () => ({
            duration: 1800,
            size: 1000,
            bitRate: 12000,
            startTime: 0,
            videoCodec: 'mpeg2video',
            audioCodec: 'aac',
            width: 1440,
            height: 1080,
        }),
    };
    const tsInfoAnalyzer = { analyze: async () => opt.tsInfo ?? emptyTsInfo() };

    return {
        model: new VideoFileAnalyzeModel(videoFileDB, videoFileTsInfoDB, recordedDB, videoUtil, tsInfoAnalyzer, logger),
        upserted: upserted,
        startAtUpdated: startAtUpdated,
    };
}

test('TS 解析結果をエンティティへ変換して保存する', async () => {
    const { model, upserted } = createModel({
        tsInfo: emptyTsInfo({
            networkId: 32416,
            transportStreamId: 32416,
            serviceId: 21504,
            serviceType: 1,
            serviceName: 'ＮＨＫ総合１・福島',
            eventId: 31702,
            eventName: '番組名',
            genres: [
                { lv1: 7, lv2: 0 },
                { lv1: 1, lv2: 2 },
            ],
            videoStreamType: 2,
            videoPid: 256,
            firstTdtAt: 1800000000000,
        }),
    });

    const analyzed = await model.analyzeTsInfo(1);

    assert.equal(analyzed, true);
    assert.equal(upserted.length, 1);
    assert.equal(upserted[0].videoFileId, 1);
    assert.equal(upserted[0].serviceName, 'ＮＨＫ総合１・福島');
    assert.equal(upserted[0].genre1, 7);
    assert.equal(upserted[0].subGenre1, 0);
    assert.equal(upserted[0].genre2, 1);
    assert.equal(upserted[0].subGenre2, 2);
    assert.equal(upserted[0].genre3, null);
    assert.equal(upserted[0].videoPid, 256);
    assert.ok(upserted[0].analyzedAt > 0);
});

test('TDT / TOT が取れた場合は録画開始時刻として記録する', async () => {
    const { model, startAtUpdated } = createModel({
        tsInfo: emptyTsInfo({ firstTdtAt: 1800000000000 }),
    });

    await model.analyzeTsInfo(1);

    assert.deepEqual(startAtUpdated, [{ id: 1, startAt: 1800000000000 }]);
});

test('TDT / TOT が取れなかった場合は録画開始時刻を書き換えない', async () => {
    const { model, startAtUpdated } = createModel({ tsInfo: emptyTsInfo() });

    await model.analyzeTsInfo(1);

    assert.equal(startAtUpdated.length, 0);
});

test('エンコード済みファイルは TS 解析の対象外', async () => {
    const { model, upserted } = createModel({ video: { type: 'encoded' } });

    const analyzed = await model.analyzeTsInfo(1);

    assert.equal(analyzed, false);
    assert.equal(upserted.length, 0);
});

test('ffprobe 解析では TS の放送時刻を推定値より優先して startAt に使う', async () => {
    const { model, startAtUpdated } = createModel({
        storedTsInfo: { videoFileId: 1, firstTdtAt: 1800000000000 },
        recorded: { id: 10, isRecording: false, startAt: 1700000000000 },
    });

    const result = await model.analyzeMetadata(1);

    // ファイルの mtime からの推定 (stat 失敗時は recorded.startAt) ではなく TDT の値になる
    assert.equal(result.startAt, 1800000000000);
    assert.deepEqual(startAtUpdated, [{ id: 1, startAt: 1800000000000 }]);
});

test('TS 情報が無い場合は従来どおり番組開始時刻へフォールバックする', async () => {
    const { model } = createModel({
        recorded: { id: 10, isRecording: false, startAt: 1700000000000 },
    });

    const result = await model.analyzeMetadata(1);

    assert.equal(result.startAt, 1700000000000);
});

test('analyzeAll は解析が失敗しても例外を投げない', async () => {
    const { model } = createModel({});
    model.analyzeTsInfo = async () => {
        throw new Error('TsAnalyzeError');
    };
    model.analyzeMetadata = async () => {
        throw new Error('FFprobeError');
    };

    await model.analyzeAll(1);
});

test('存在しない video file id を指定すると例外を投げる', async () => {
    const { model } = createModel({});

    await assert.rejects(() => model.analyzeTsInfo(999), /VideoFileIsUndefined/);
    await assert.rejects(() => model.analyzeMetadata(999), /VideoFileIsUndefined/);
});
