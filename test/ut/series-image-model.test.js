'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SeriesImageModel = require('../../dist/model/api/series/SeriesImageModel').default;

const logger = { getLogger: () => ({ system: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } }) };

function makeConfig({ seriesLibrary = true, metadataProviders = true, thumbnail = '/tmp/thumb' } = {}) {
    return { getConfig: () => ({ featureFlags: { seriesLibrary, metadataProviders }, thumbnail }) };
}

function makeSeriesDB(series = {}, thumbnailPaths = new Map()) {
    return {
        getSeries: async id => series[id] ?? null,
        listRecorded: async () => [],
        findThumbnailPaths: async ids => new Map([...thumbnailPaths].filter(([k]) => ids.includes(k))),
    };
}

function makeAnnictDB(works = []) {
    return {
        get: async id => works.find(w => w.annictId === id) ?? null,
        findBySyobocalTid: async tid => works.find(w => w.syobocalTid === tid) ?? null,
    };
}

function makeHttp(responses = {}) {
    return {
        get: async url => {
            const r = responses[url];
            if (typeof r === 'undefined') throw new Error('unexpected url ' + url);
            if (r instanceof Error) throw r;
            return {
                status: r.status ?? 200,
                headers: new Headers(r.contentType ? { 'content-type': r.contentType } : {}),
                text: '',
                json: () => ({}),
                buffer: r.body,
            };
        },
        post: async () => ({ status: 200, headers: new Headers(), text: '', json: () => ({}) }),
    };
}

test('getInfo() returns the Annict image url and copyright', async () => {
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB({ 1: { id: 1, annictId: '10', syobocalTid: null } }),
        makeAnnictDB([{ annictId: 10, imageUrl: 'https://example.test/a.jpg', imageCopyright: '(C) test' }]),
        makeHttp(),
        { findByRecordedId: async () => null },
    );

    assert.deepEqual(await model.getInfo(1), {
        source: 'annict',
        url: 'https://example.test/a.jpg',
        copyright: '(C) test',
    });
});

test('getInfo() resolves the work through syobocalTid when annictId is missing', async () => {
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB({ 1: { id: 1, annictId: null, syobocalTid: 555 } }),
        makeAnnictDB([{ annictId: 10, syobocalTid: 555, imageUrl: 'https://example.test/b.png', imageCopyright: null }]),
        makeHttp(),
        { findByRecordedId: async () => null },
    );

    assert.equal((await model.getInfo(1)).url, 'https://example.test/b.png');
});

test('getInfo() returns null while the feature flags are off', async () => {
    const model = new SeriesImageModel(
        logger,
        makeConfig({ metadataProviders: false }),
        makeSeriesDB({ 1: { id: 1, annictId: '10', syobocalTid: null } }),
        makeAnnictDB([{ annictId: 10, imageUrl: 'https://example.test/a.jpg', imageCopyright: null }]),
        makeHttp(),
        { findByRecordedId: async () => null },
    );

    assert.equal(await model.getInfo(1), null);
});

test('getInfoMap() falls back to a recording thumbnail for works without an Annict image', async () => {
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB(
            { 1: { id: 1, annictId: '10', syobocalTid: null }, 2: { id: 2, annictId: null, syobocalTid: null } },
            new Map([[2, 'a/b.jpg']]),
        ),
        makeAnnictDB([{ annictId: 10, imageUrl: 'https://example.test/a.jpg', imageCopyright: '(C) x' }]),
        makeHttp(),
        { findByRecordedId: async () => null },
    );

    const map = await model.getInfoMap([1, 2, 3]);
    assert.equal(map.get(1).source, 'annict');
    assert.equal(map.get(2).source, 'thumbnail');
    // サムネイルも無いシリーズは画像なしとして扱う
    assert.equal(map.has(3), false);
});

test('getFile() downloads, caches and reuses the image without refetching', async () => {
    const cacheDir = path.join(__dirname, '..', '..', 'data', 'seriesImage');
    const annictId = 990001;
    for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
        await fs.promises.rm(path.join(cacheDir, `${annictId}${ext}`), { force: true });
    }
    let fetches = 0;
    const http = {
        get: async () => {
            fetches++;
            return {
                status: 200,
                headers: new Headers({ 'content-type': 'image/png' }),
                text: '',
                json: () => ({}),
                buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            };
        },
        post: async () => ({ status: 200, headers: new Headers(), text: '', json: () => ({}) }),
    };
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB({ 1: { id: 1, annictId: String(annictId), syobocalTid: null } }),
        makeAnnictDB([{ annictId, imageUrl: 'https://example.test/a.png', imageCopyright: null }]),
        http,
        { findByRecordedId: async () => null },
    );

    const first = await model.getFile(1);
    assert.equal(first.contentType, 'image/png');
    assert.ok(first.filePath.endsWith(`${annictId}.png`));
    const second = await model.getFile(1);
    assert.equal(second.filePath, first.filePath);
    // 2 回目はキャッシュから返るので取得しない
    assert.equal(fetches, 1);

    await fs.promises.rm(first.filePath, { force: true });
});

test('getFile() rejects a non-image content type and falls back to the thumbnail', async () => {
    const thumbDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'epgstation-thumb-'));
    await fs.promises.mkdir(path.join(thumbDir, 'a'), { recursive: true });
    await fs.promises.writeFile(path.join(thumbDir, 'a', 'b.jpg'), 'x');

    const model = new SeriesImageModel(
        logger,
        makeConfig({ thumbnail: thumbDir }),
        {
            getSeries: async () => ({ id: 1, annictId: '990002', syobocalTid: null }),
            listRecorded: async () => [{ recordedId: 7 }],
            findThumbnailPaths: async () => new Map(),
        },
        makeAnnictDB([{ annictId: 990002, imageUrl: 'https://example.test/x.html', imageCopyright: null }]),
        // Twitter の profile_image のように画像ではなく HTML が返るケース
        makeHttp({ 'https://example.test/x.html': { contentType: 'text/html', body: Buffer.from('<html>') } }),
        { findByRecordedId: async () => ({ id: 1, recordedId: 7, filePath: 'a/b.jpg' }) },
    );

    const file = await model.getFile(1);
    assert.notEqual(file, null);
    assert.equal(file.contentType, 'image/jpeg');
    assert.ok(file.filePath.endsWith(path.join('a', 'b.jpg')));

    await fs.promises.rm(thumbDir, { recursive: true, force: true });
});
