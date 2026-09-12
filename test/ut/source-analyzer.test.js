'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SourceAnalyzer = require('../../dist/model/stream/capability/SourceAnalyzer').default;

const channel = channelType => ({ channelType });

test('BS4K ライブは仕様の既定映像特性を返し、キャッシュする', async () => {
    let findCount = 0;
    const analyzer = new SourceAnalyzer(
        {},
        {},
        {
            findId: async () => {
                findCount++;
                return channel('BS4K');
            },
        },
    );

    const first = await analyzer.analyzeLiveChannel(1);
    const second = await analyzer.analyzeLiveChannel(1);

    assert.deepEqual(first, {
        transport: 'mpegts',
        codec: 'hevc',
        width: 3840,
        height: 2160,
        bitDepth: 10,
        scan: 'progressive',
        frameRate: 59.94,
        fieldOrder: 'unknown',
        colorPrimaries: 'bt2020',
        transfer: 'hlg',
        hdr: 'hlg',
        sourceClass: 'bs4k',
        confidence: 'medium',
    });
    assert.strictEqual(second, first);
    assert.equal(findCount, 1);
});

test('通常放送ライブは legacy-broadcast の既定値を返す', async () => {
    const analyzer = new SourceAnalyzer({}, {}, { findId: async () => channel('GR') });

    const source = await analyzer.analyzeLiveChannel(2);

    assert.equal(source.sourceClass, 'legacy-broadcast');
    assert.equal(source.codec, 'mpeg2');
    assert.equal(source.scan, 'interlaced');
    assert.equal(source.fieldOrder, 'tff');
    assert.equal(source.frameRate, 29.97);
    assert.equal(source.bitDepth, 8);
    assert.equal(source.hdr, 'sdr');
});

test('解析済み録画も ffprobe の field_order / fps を優先し、失敗時は DB 情報へ戻る', async () => {
    let probeCount = 0;
    const analyzer = new SourceAnalyzer(
        { findId: async () => ({ analyzedAt: 1, filePath: 'recorded.ts', videoCodec: 'hevc', width: 3840, height: 2160 }) },
        {
            getFullFilePathFromVideoFile: () => '/recorded.ts',
            getDetailedInfo: async () => {
                probeCount++;
                throw new Error('unexpected ffprobe');
            },
        },
        {},
    );

    const source = await analyzer.analyzeRecordedFile(3);

    assert.equal(source.codec, 'hevc');
    assert.equal(source.width, 3840);
    assert.equal(source.height, 2160);
    assert.equal(source.transport, 'mpegts');
    assert.equal(probeCount, 1);
});

test('録画の ffprobe 結果から progressive と fps を保持する', async () => {
    const analyzer = new SourceAnalyzer(
        { findId: async () => ({ analyzedAt: 1, filePath: 'recorded.ts' }) },
        {
            getFullFilePathFromVideoFile: () => '/recorded.ts',
            getDetailedInfo: async () => ({
                duration: 60,
                size: 1,
                bitRate: 1,
                startTime: 0,
                videoCodec: 'hevc',
                audioCodec: null,
                width: 1440,
                height: 1080,
                fieldOrder: 'unknown',
                avgFrameRate: '60000/1001',
                rFrameRate: '60000/1001',
            }),
        },
        {},
    );

    const source = await analyzer.analyzeRecordedFile(4);

    assert.equal(source.scan, 'unknown');
    assert.ok(Math.abs(source.frameRate - 59.94005994) < 0.001);
    assert.equal(source.transport, 'mpegts');
});

test('DB fallback は fps 不明のため yadif 有りになり、結果をキャッシュせず ffprobe を再試行する', async () => {
    let filePath = null;
    let probeCount = 0;
    const logs = [];
    const analyzer = new SourceAnalyzer(
        { findId: async () => ({ analyzedAt: 1, filePath: 'recorded.ts', videoCodec: 'hevc', width: 1440, height: 1080 }) },
        {
            getFullFilePathFromVideoFile: () => filePath,
            getDetailedInfo: async () => {
                probeCount++;
                return {
                    duration: 60,
                    size: 1,
                    bitRate: 1,
                    startTime: 0,
                    videoCodec: 'hevc',
                    audioCodec: null,
                    width: 1440,
                    height: 1080,
                    fieldOrder: 'unknown',
                    avgFrameRate: '60000/1001',
                    rFrameRate: '60000/1001',
                };
            },
        },
        {},
        { getLogger: () => ({ stream: { info: message => logs.push(message) } }) },
    );

    const fallback = await analyzer.analyzeRecordedFile(5);
    assert.equal(fallback.frameRate, undefined);
    filePath = '/recorded.ts';
    const probed = await analyzer.analyzeRecordedFile(5);

    assert.equal(probeCount, 1);
    assert.ok(Math.abs(probed.frameRate - 59.94005994) < 0.001);
    assert.equal(
        logs[0],
        'deinterlace: yadif=true (source: db-fallback, codec: hevc, field_order: unknown, fps: unknown)',
    );
    assert.equal(
        logs[1],
        'deinterlace: yadif=false (source: ffprobe, codec: hevc, field_order: unknown, fps: 59.94)',
    );
});
