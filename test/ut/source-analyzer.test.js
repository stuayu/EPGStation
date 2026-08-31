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

test('解析済み録画は DB 情報を使い ffprobe を実行しない', async () => {
    let probeCount = 0;
    const analyzer = new SourceAnalyzer(
        { findId: async () => ({ analyzedAt: 1, videoCodec: 'hevc', width: 3840, height: 2160 }) },
        {
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
    assert.equal(probeCount, 0);
});
