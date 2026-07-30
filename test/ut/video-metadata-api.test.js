'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const VideoApiModel = require('../../dist/model/api/video/VideoApiModel').default;
const VideoFileAnalyzeModel = require('../../dist/model/video/VideoFileAnalyzeModel').default;

const configuration = { getConfig: () => ({}) };

function createModel(options) {
    const opt = options || {};
    const updated = [];
    const startAtUpdated = [];
    const videos = opt.videos || [];
    const videoFileDB = {
        findId: async id => videos.find(v => v.id === id) || null,
        findWithoutMetadata: async limit => videos.filter(v => v.analyzedAt === null).slice(0, limit),
        countWithoutMetadata: async () => videos.filter(v => v.analyzedAt === null).length,
        countAll: async () => videos.length,
        updateMetadata: async (id, metadata) => {
            updated.push({ id: id, metadata: metadata });
            const video = videos.find(v => v.id === id);
            if (typeof video !== 'undefined') {
                video.analyzedAt = 1;
            }
        },
        updateStartAt: async (id, startAt) => {
            startAtUpdated.push({ id: id, startAt: startAt });
            const video = videos.find(v => v.id === id);
            if (typeof video !== 'undefined') {
                video.startAt = startAt;
            }
        },
    };
    const recordedDB = {
        findId: async () => opt.recorded || null,
    };
    const videoUtil = {
        getFullFilePathFromVideoFile: () => opt.filePath || '/tmp/not-exists.ts',
        getDetailedInfo: async () => {
            if (opt.detailedInfoError === true) {
                throw new Error('FFprobeError');
            }

            return Object.assign(
                {
                    duration: 1800,
                    size: 1000,
                    bitRate: 12000,
                    startTime: 1.5,
                    videoCodec: 'h264',
                    audioCodec: 'aac',
                    width: 1920,
                    height: 1080,
                },
                opt.detailedInfo,
            );
        },
    };

    // ffprobe 解析の実処理は VideoFileAnalyzeModel にあり、VideoApiModel はそこへ委譲する
    const videoFileTsInfoDB = {
        findId: async () => opt.tsInfo ?? null,
        upsert: async () => {},
    };
    const tsInfoAnalyzer = {
        analyze: async () => opt.tsAnalyzeResult ?? { firstTdtAt: null, genres: [] },
    };
    const analyzeModel = new VideoFileAnalyzeModel(
        videoFileDB,
        videoFileTsInfoDB,
        recordedDB,
        videoUtil,
        tsInfoAnalyzer,
    );

    return {
        model: new VideoApiModel(configuration, videoFileDB, recordedDB, {}, videoUtil, {}, analyzeModel),
        updated: updated,
        startAtUpdated: startAtUpdated,
    };
}

function video(id, override) {
    return Object.assign(
        {
            id: id,
            recordedId: 100 + id,
            size: 500,
            startAt: null,
            analyzedAt: null,
            duration: null,
            startTime: null,
            videoCodec: null,
            audioCodec: null,
            width: null,
            height: null,
            bitRate: null,
        },
        override,
    );
}

test('analyzeMetadata stores ffprobe results into the video file table', async () => {
    const { model, updated } = createModel({ videos: [video(1)], recorded: { id: 101, isRecording: false, startAt: 1700000000000 } });
    const result = await model.analyzeMetadata(1);
    assert.equal(result.duration, 1800);
    assert.equal(result.videoCodec, 'h264');
    assert.equal(result.width, 1920);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].metadata.audioCodec, 'aac');
});

test('analyzeMetadata falls back to the recorded startAt when the file can not be stat', async () => {
    const { model, startAtUpdated } = createModel({
        videos: [video(1)],
        recorded: { id: 101, isRecording: false, startAt: 1700000000000 },
    });
    const result = await model.analyzeMetadata(1);
    assert.equal(result.startAt, 1700000000000);
    assert.equal(startAtUpdated[0].startAt, 1700000000000);
});

test('analyzeMetadata does not estimate startAt while recording', async () => {
    const { model, startAtUpdated } = createModel({
        videos: [video(1)],
        recorded: { id: 101, isRecording: true, startAt: 1700000000000 },
    });
    const result = await model.analyzeMetadata(1);
    assert.equal(result.startAt, null);
    assert.equal(startAtUpdated.length, 0);
});

test('getMetadata returns stored values without re-running ffprobe', async () => {
    const { model, updated } = createModel({
        videos: [video(1, { analyzedAt: 10, duration: 60, startAt: 1700000000000, videoCodec: 'hevc' })],
    });
    const result = await model.getMetadata(1);
    assert.equal(result.duration, 60);
    assert.equal(result.videoCodec, 'hevc');
    assert.equal(updated.length, 0);
});

test('getMetadata throws when the video file does not exist', async () => {
    const { model } = createModel({ videos: [] });
    await assert.rejects(() => model.getMetadata(999), /VideoFileIsUndefined/);
});

test('analyzeAllMetadata counts failures and reports the remaining files', async () => {
    const { model } = createModel({
        videos: [video(1), video(2)],
        detailedInfoError: true,
        recorded: { id: 101, isRecording: false, startAt: 1 },
    });
    const result = await model.analyzeAllMetadata(10);
    assert.equal(result.analyzed, 0);
    assert.equal(result.failed, 2);
    assert.equal(result.remaining, 2);
});

test('analyzeAllMetadata analyzes unanalyzed files up to the given limit', async () => {
    const { model } = createModel({
        videos: [video(1), video(2), video(3)],
        recorded: { id: 101, isRecording: false, startAt: 1 },
    });
    const result = await model.analyzeAllMetadata(2);
    assert.equal(result.analyzed, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.remaining, 1);
});

test('getMetadataStatus returns total / analyzed / unanalyzed counts', async () => {
    const { model } = createModel({ videos: [video(1, { analyzedAt: 5 }), video(2), video(3)] });
    const status = await model.getMetadataStatus();
    assert.deepEqual(status, { total: 3, analyzed: 1, unanalyzed: 2 });
});
