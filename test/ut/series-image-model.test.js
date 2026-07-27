'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SeriesImageModel = require('../../dist/model/api/series/SeriesImageModel').default;

// 外部サービスのエンドポイントは設定で差し替え可能なため、既定値を返すスタブを渡す
const endpoints = {
    resolve: async name =>
        ({
            syobocal: 'https://cal.syoboi.jp/db.php',
            annict: 'https://api.annict.com/graphql',
            fxtwitter: 'https://api.fxtwitter.com/',
            sharedData: '',
        })[name],
    getDefaults: () => ({}),
};

const logger = { getLogger: () => ({ system: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } }) };

function makeConfig({ seriesLibrary = true, metadataProviders = true, thumbnail = '/tmp/thumb' } = {}) {
    return { getConfig: () => ({ featureFlags: { seriesLibrary, metadataProviders }, thumbnail }) };
}

function makeSeriesDB(series = {}, thumbnailPaths = new Map(), recorded = []) {
    return {
        getSeries: async id => series[id] ?? null,
        listRecorded: async () => recorded,
        findThumbnailPaths: async ids => new Map([...thumbnailPaths].filter(([k]) => ids.includes(k))),
    };
}

// サムネイル生成依頼 (Operator への IPC) を記録するスタブ
function makeIpc(calls = []) {
    return { calls, thumbnail: { add: async videoFileId => calls.push(videoFileId) } };
}
const noThumbnailDB = { findByRecordedId: async () => null };
const noRecordedDB = { findId: async () => null };

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
                json: () => r.json ?? {},
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
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
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
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
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
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
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
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
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
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
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
        noRecordedDB,
        makeIpc(),
        endpoints,
    );

    const file = await model.getFile(1);
    assert.notEqual(file, null);
    assert.equal(file.contentType, 'image/jpeg');
    assert.ok(file.filePath.endsWith(path.join('a', 'b.jpg')));

    await fs.promises.rm(thumbDir, { recursive: true, force: true });
});

test('getFile() resolves a Twitter avatar through the fxtwitter API', async () => {
    const annictId = 990010;
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB({ 1: { id: 1, annictId: String(annictId), syobocalTid: null } }),
        makeAnnictDB([
            { annictId, imageUrl: 'https://twitter.com/some_anime/profile_image?size=bigger', imageCopyright: null },
        ]),
        makeHttp({
            // x.com 移行後、profile_image の URL 自体は叩かず fxtwitter の JSON API を引く
            'https://api.fxtwitter.com/some_anime': {
                contentType: 'application/json',
                json: { user: { avatar_url: 'https://pbs.twimg.test/profile_images/1/a_normal.jpg' } },
            },
            // _normal は小さすぎるので 400x400 を優先して取得する
            'https://pbs.twimg.test/profile_images/1/a_400x400.jpg': {
                contentType: 'image/jpeg',
                body: Buffer.from([0xff, 0xd8]),
            },
        }),
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
    );

    const file = await model.getFile(1);
    assert.notEqual(file, null);
    assert.equal(file.contentType, 'image/jpeg');
    await fs.promises.rm(file.filePath, { force: true });
});

test('getFile() falls back to the original avatar size when 400x400 does not exist', async () => {
    const annictId = 990011;
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB({ 1: { id: 1, annictId: String(annictId), syobocalTid: null } }),
        makeAnnictDB([
            { annictId, imageUrl: 'https://twitter.com/some_anime/profile_image?size=bigger', imageCopyright: null },
        ]),
        makeHttp({
            'https://api.fxtwitter.com/some_anime': {
                contentType: 'application/json',
                json: { user: { avatar_url: 'https://pbs.twimg.test/profile_images/2/b_normal.png' } },
            },
            'https://pbs.twimg.test/profile_images/2/b_400x400.png': { status: 404, contentType: 'text/html' },
            'https://pbs.twimg.test/profile_images/2/b_normal.png': {
                contentType: 'image/png',
                body: Buffer.from([0x89, 0x50]),
            },
        }),
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
    );

    const file = await model.getFile(1);
    assert.notEqual(file, null);
    assert.equal(file.contentType, 'image/png');
    await fs.promises.rm(file.filePath, { force: true });
});

test('getFile() does not request the dead profile_image url when the account is gone', async () => {
    const requested = [];
    const http = {
        get: async url => {
            requested.push(url);
            // fxtwitter は削除済みアカウントに HTTP 200 + { code: 404 } を返す
            return {
                status: 200,
                headers: new Headers({ 'content-type': 'application/json' }),
                text: '',
                json: () => ({ code: 404, message: 'User not found' }),
            };
        },
        post: async () => ({ status: 200, headers: new Headers(), text: '', json: () => ({}) }),
    };
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB({ 1: { id: 1, annictId: '990012', syobocalTid: null } }),
        makeAnnictDB([
            { annictId: 990012, imageUrl: 'https://twitter.com/gone/profile_image?size=bigger', imageCopyright: null },
        ]),
        http,
        noThumbnailDB,
        noRecordedDB,
        makeIpc(),
        endpoints,
    );

    assert.equal(await model.getFile(1), null);
    // 画像を返さないと分かっている元 URL は叩かない
    assert.deepEqual(requested, ['https://api.fxtwitter.com/gone']);
});

test('getFile() asks the operator to generate a thumbnail when no image exists anywhere', async () => {
    const calls = [];
    const model = new SeriesImageModel(
        logger,
        makeConfig(),
        makeSeriesDB({ 1: { id: 1, annictId: null, syobocalTid: null } }, new Map(), [{ recordedId: 7 }]),
        makeAnnictDB(),
        makeHttp(),
        noThumbnailDB,
        // ts の動画ファイルを優先してサムネイル生成を依頼する
        { findId: async () => ({ id: 7, videoFiles: [{ id: 71, type: 'encoded' }, { id: 70, type: 'ts' }] }) },
        makeIpc(calls),
        endpoints,
    );

    assert.equal(await model.getFile(1), null);
    // 生成依頼は応答をブロックしないよう投げっぱなしにしているので、完了を待ってから確認する
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [70]);

    // 生成が終わるまでの間に連打されても再依頼しない
    await model.getFile(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [70]);
});
