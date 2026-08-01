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
            videoType: null,
            videoResolution: null,
            videoStreamContent: null,
            videoComponentType: null,
            audioSamplingRate: null,
            audioComponentType: null,
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
    const video = Object.assign(
        { id: 1, recordedId: 10, type: 'ts', filePath: 'recorded.ts', size: 100, startAt: null },
        opt.video,
    );

    const videoFileDB = {
        findId: async id => (id === video.id ? video : null),
        updateMetadata: async () => {},
        updateStartAt: async (id, startAt) => startAtUpdated.push({ id, startAt }),
    };
    const videoFileTsInfoDB = {
        upsert: async info => upserted.push(info),
        findId: async () => opt.storedTsInfo ?? null,
    };
    const channelUpdates = [];
    const programUpdates = [];
    const recordedDB = {
        findId: async () => opt.recorded ?? null,
        updateChannel: async (recordedId, values) => channelUpdates.push({ recordedId, values }),
        updateProgramInfo: async (recordedId, values) => programUpdates.push({ recordedId, values }),
    };
    const channelDB = {
        findId: async id => (opt.channels ?? []).find(c => c.id === id) ?? null,
        findNetworkIdAndServiceId: async (networkId, serviceId) =>
            (opt.channels ?? []).find(c => c.networkId === networkId && c.serviceId === serviceId) ?? null,
    };
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
        model: new VideoFileAnalyzeModel(
            videoFileDB,
            videoFileTsInfoDB,
            recordedDB,
            videoUtil,
            tsInfoAnalyzer,
            channelDB,
            logger,
        ),
        upserted: upserted,
        startAtUpdated: startAtUpdated,
        channelUpdates: channelUpdates,
        programUpdates: programUpdates,
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

test('完全な再マルチプレクス (.mp4 等) は拡張子で TS 解析の対象外にする', async () => {
    // video_file.type はストリーミングパイプラインの選択にも使うため対象判定には使わない。
    // 拡張子が .ts 以外 (= 完全な再マルチプレクスで PSI/SI が無い) ものだけを除外する
    const { model, upserted } = createModel({ video: { type: 'encoded', filePath: 'output.mp4' } });

    const analyzed = await model.analyzeTsInfo(1);

    assert.equal(analyzed, false);
    assert.equal(upserted.length, 0);
});

test('tsreplace 系 (type: encoded だが拡張子が .ts) は TS 解析の対象に含める', async () => {
    const { model, upserted } = createModel({
        video: { type: 'encoded', filePath: 'output.hevc.ts' },
        tsInfo: emptyTsInfo({ serviceName: 'ＮＨＫ総合１・福島' }),
    });

    const analyzed = await model.analyzeTsInfo(1);

    assert.equal(analyzed, true);
    assert.equal(upserted.length, 1);
    assert.equal(upserted[0].serviceName, 'ＮＨＫ総合１・福島');
});

test('拡張子の大文字小文字を区別しない (.TS も対象に含める)', async () => {
    const { model, upserted } = createModel({ video: { type: 'encoded', filePath: 'output.HEVC.TS' } });

    const analyzed = await model.analyzeTsInfo(1);

    assert.equal(analyzed, true);
    assert.equal(upserted.length, 1);
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

test('TS の network id + service id で放送局を引けたら、その放送局へ紐付け直す', async () => {
    // 取り込み時に放送局を特定できず、channel を引けない状態の録画
    const { model, channelUpdates } = createModel({
        recorded: { id: 10, channelId: 0, channelName: null, halfWidthChannelName: null },
        channels: [
            { id: 3273601024, networkId: 32736, serviceId: 1024, name: 'ＮＨＫ総合１', halfWidthName: 'NHK総合1' },
        ],
        tsInfo: emptyTsInfo({ networkId: 32736, serviceId: 1024, serviceName: 'ＮＨＫ総合１・福島' }),
    });

    await model.analyzeTsInfo(1);

    assert.deepEqual(channelUpdates, [
        {
            recordedId: 10,
            values: { channelId: 3273601024, channelName: 'ＮＨＫ総合１', halfWidthChannelName: 'NHK総合1' },
        },
    ]);
});

test('channel テーブルに無い放送局は、表示名が空のときだけ SDT の局名で補う', async () => {
    const { model, channelUpdates } = createModel({
        recorded: { id: 10, channelId: 0, channelName: null, halfWidthChannelName: null },
        channels: [],
        tsInfo: emptyTsInfo({ networkId: 41072, serviceId: 23608, serviceName: 'とちぎテレビ1' }),
    });

    await model.analyzeTsInfo(1);

    assert.deepEqual(channelUpdates, [
        { recordedId: 10, values: { channelName: 'とちぎテレビ1', halfWidthChannelName: 'とちぎテレビ1' } },
    ]);
});

test('すでに放送局を引ける録画や、局名が入っている録画には触らない', async () => {
    // channel を引ける = 画面で正しく表示できているので書き換えない
    const resolvable = createModel({
        recorded: { id: 10, channelId: 3273601024, channelName: 'ＮＨＫ総合１', halfWidthChannelName: 'NHK総合1' },
        channels: [
            { id: 3273601024, networkId: 32736, serviceId: 1024, name: 'ＮＨＫ総合１', halfWidthName: 'NHK総合1' },
        ],
        tsInfo: emptyTsInfo({ networkId: 32736, serviceId: 1024, serviceName: '別の名前' }),
    });
    await resolvable.model.analyzeTsInfo(1);
    assert.deepEqual(resolvable.channelUpdates, []);

    // channel は引けないが、録画時点の局名が残っているものも上書きしない
    const named = createModel({
        recorded: { id: 10, channelId: 12345, channelName: 'とちぎテレビ1', halfWidthChannelName: 'とちぎテレビ1' },
        channels: [],
        tsInfo: emptyTsInfo({ networkId: 41072, serviceId: 23608, serviceName: 'TOCHIGI TV' }),
    });
    await named.model.analyzeTsInfo(1);
    assert.deepEqual(named.channelUpdates, []);
});

test('局名の書き戻しに失敗しても TS 解析自体は成功扱いにする', async () => {
    const { model, upserted } = createModel({
        recorded: { id: 10, channelId: 0, channelName: null, halfWidthChannelName: null },
        channels: [],
        tsInfo: emptyTsInfo({ networkId: 41072, serviceId: 23608, serviceName: 'とちぎテレビ1' }),
    });
    model.recordedDB.updateChannel = async () => {
        throw new Error('db is down');
    };

    assert.equal(await model.analyzeTsInfo(1), true);
    assert.equal(upserted.length, 1);
});

test('番組情報が空の録画は EIT[p/f] の内容 (概要・詳細・ジャンル・映像音声) で補完する', async () => {
    // API 経由で録画情報だけ先に作り、後から TS を追加した録画 (外部連携での登録) を想定する
    const { model, programUpdates } = createModel({
        recorded: { id: 10, isRecording: false, startAt: 1700000000000, channelId: 1 },
        channels: [{ id: 1, networkId: 32416, serviceId: 21504, name: 'ＮＨＫ総合１', halfWidthName: 'NHK総合1' }],
        tsInfo: emptyTsInfo({
            networkId: 32416,
            serviceId: 21504,
            eventDescription: '番組の概要',
            eventExtended: '出演者\n誰か',
            genres: [
                { lv1: 7, lv2: 0 },
                { lv1: 1, lv2: 2 },
            ],
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 1,
            videoComponentType: 0xb1,
            audioSamplingRate: 48000,
            audioComponentType: 3,
        }),
    });

    await model.analyzeTsInfo(1);

    assert.equal(programUpdates.length, 1);
    assert.equal(programUpdates[0].recordedId, 10);
    assert.equal(programUpdates[0].values.description, '番組の概要');
    assert.equal(programUpdates[0].values.genre1, 7);
    assert.equal(programUpdates[0].values.subGenre1, 0);
    assert.equal(programUpdates[0].values.genre2, 1);
    assert.equal(programUpdates[0].values.videoType, 'mpeg2');
    assert.equal(programUpdates[0].values.videoResolution, '1080i');
    assert.equal(programUpdates[0].values.audioSamplingRate, 48000);
});

test('すでに入っている番組情報は TS の内容で上書きしない', async () => {
    const { model, programUpdates } = createModel({
        recorded: {
            id: 10,
            isRecording: false,
            startAt: 1700000000000,
            channelId: 1,
            description: '画面から入力した概要',
            genre1: 6,
            videoType: 'h.264',
        },
        channels: [{ id: 1, networkId: 32416, serviceId: 21504, name: 'ＮＨＫ総合１', halfWidthName: 'NHK総合1' }],
        tsInfo: emptyTsInfo({
            networkId: 32416,
            serviceId: 21504,
            eventDescription: '番組の概要',
            genres: [{ lv1: 7, lv2: 0 }],
            videoType: 'mpeg2',
            audioSamplingRate: 48000,
        }),
    });

    await model.analyzeTsInfo(1);

    // 空だった audioSamplingRate だけが補完される
    assert.deepEqual(programUpdates[0].values, { audioSamplingRate: 48000 });
});
