'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesMetadataFiller = require('../../dist/model/series/SeriesMetadataFiller').default;

const logger = { getLogger: () => ({ system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }) };
const config = { getConfig: () => ({ featureFlags: { seriesLibrary: true, metadataProviders: true } }) };

function makeDB(series, firstAiredAt = new Map()) {
    const updates = [];
    return {
        updates,
        findAllSeries: async () => series,
        findFirstAiredAtMap: async () => firstAiredAt,
        updateExternalMetadata: async (id, patch) => updates.push({ id, patch }),
    };
}
const emptyDict = { lookup: async () => null, lookupEpisodeNumber: async () => null };

function series(over = {}) {
    return {
        id: 1,
        title: '作品',
        syobocalTid: null,
        annictId: null,
        titleKana: null,
        seasonYear: null,
        seasonName: null,
        seasonSource: null,
        totalEpisodes: null,
        ...over,
    };
}

test('fill() takes the season from the work dictionary when it matches', async () => {
    const db = makeDB([series()]);
    const dict = {
        lookup: async () => ({
            syobocalTid: 10,
            annictId: 20,
            title: '作品',
            titleKana: 'さくひん',
            seasonYear: 2024,
            seasonName: 'AUTUMN',
            totalEpisodes: 12,
        }),
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict).fill();

    assert.equal(result.updated, 1);
    assert.deepEqual(db.updates[0].patch, {
        syobocalTid: 10,
        annictId: '20',
        titleKana: 'さくひん',
        totalEpisodes: 12,
        seasonYear: 2024,
        seasonName: 'AUTUMN',
        seasonSource: 'dictionary',
    });
});

test('fill() estimates the season from the earliest recording when the dictionary has none', async () => {
    // 2024-11-05 の録画 → 2024 年秋
    const db = makeDB([series()], new Map([[1, Date.parse('2024-11-05T21:00:00+09:00')]]));
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict).fill();

    assert.equal(result.updated, 1);
    assert.equal(db.updates[0].patch.seasonYear, 2024);
    assert.equal(db.updates[0].patch.seasonName, 'AUTUMN');
    // 推測値であることを記録し、辞書の値と区別できるようにする
    assert.equal(db.updates[0].patch.seasonSource, 'estimated');
});

test('fill() maps each month to the right season', async () => {
    const cases = [
        ['2025-02-01T12:00:00+09:00', 'WINTER'],
        ['2025-05-01T12:00:00+09:00', 'SPRING'],
        ['2025-08-01T12:00:00+09:00', 'SUMMER'],
        ['2025-12-01T12:00:00+09:00', 'AUTUMN'],
    ];
    for (const [iso, expected] of cases) {
        const db = makeDB([series()], new Map([[1, Date.parse(iso)]]));
        await new SeriesMetadataFiller(logger, config, db, emptyDict).fill();
        assert.equal(db.updates[0].patch.seasonName, expected, iso);
    }
});

test('fill() never overwrites a manually set season', async () => {
    const db = makeDB(
        [series({ seasonYear: 2020, seasonName: 'SPRING', seasonSource: 'manual', titleKana: 'x', totalEpisodes: 1, syobocalTid: 1, annictId: '1' })],
        new Map([[1, Date.parse('2024-11-05T21:00:00+09:00')]]),
    );
    const dict = {
        lookup: async () => ({
            syobocalTid: 10,
            annictId: 20,
            title: '作品',
            titleKana: 'さくひん',
            seasonYear: 2024,
            seasonName: 'AUTUMN',
            totalEpisodes: 12,
        }),
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict).fill();

    assert.equal(result.updated, 0);
    assert.equal(db.updates.length, 0);
});

test('fill() leaves the season unset when there is neither a match nor a recording', async () => {
    const db = makeDB([series()], new Map());
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict).fill();

    assert.equal(result.updated, 0);
});

test('fill() skips series that already have everything', async () => {
    const db = makeDB([
        series({ titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', seasonSource: 'dictionary', totalEpisodes: 12, syobocalTid: 1, annictId: '2' }),
    ]);
    let looked = 0;
    const dict = { lookup: async () => { looked++; return null; }, lookupEpisodeNumber: async () => null };
    const result = await new SeriesMetadataFiller(logger, config, db, dict).fill();

    assert.equal(result.updated, 0);
    // 辞書も引かない (繰り返し実行しても安い)
    assert.equal(looked, 0);
});
