'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesMetadataFiller = require('../../dist/model/series/SeriesMetadataFiller').default;

const logger = { getLogger: () => ({ system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }) };
const config = { getConfig: () => ({ featureFlags: { seriesLibrary: true, metadataProviders: true } }) };

function makeDB(series, firstAiredAt = new Map()) {
    const updates = [];
    const aliases = [];
    return {
        updates,
        aliases,
        findAllSeries: async () => series,
        findAlias: async () => null,
        upsertAlias: async (normalizedTitle, seriesId, createdAt, source) => aliases.push({ normalizedTitle, seriesId, source }),
        findFirstAiredAtMap: async () => firstAiredAt,
        updateExternalMetadata: async (id, patch) => updates.push({ id, patch }),
    };
}
const emptyDict = { lookup: async () => null, lookupEpisodeNumber: async () => null };
const noLlm = { isEnabled: () => false, isSuspended: () => false, extractWorkTitle: async () => null };

function series(over = {}) {
    return {
        id: 1,
        title: '作品',
        normalizedTitle: '作品',
        syobocalTid: null,
        annictId: null,
        wikidataQid: null,
        tmdbId: null,
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
            wikidataQid: 'Q1',
            tmdbId: 5,
            title: '作品',
            titleKana: 'さくひん',
            seasonYear: 2024,
            seasonName: 'AUTUMN',
            totalEpisodes: 12,
        }),
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm).fill();

    assert.equal(result.updated, 1);
    assert.deepEqual(db.updates[0].patch, {
        syobocalTid: 10,
        annictId: '20',
        wikidataQid: 'Q1',
        tmdbId: 5,
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
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm).fill();

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
        await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm).fill();
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
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm).fill();

    assert.equal(result.updated, 0);
    assert.equal(db.updates.length, 0);
});

test('fill() leaves the season unset when there is neither a match nor a recording', async () => {
    const db = makeDB([series()], new Map());
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm).fill();

    assert.equal(result.updated, 0);
});

test('fill() skips series that already have everything', async () => {
    const db = makeDB([
        series({ titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', seasonSource: 'dictionary', totalEpisodes: 12, syobocalTid: 1, annictId: '2' }),
    ]);
    let looked = 0;
    const dict = { lookup: async () => { looked++; return null; }, lookupEpisodeNumber: async () => null };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm).fill();

    assert.equal(result.updated, 0);
    // 辞書も引かない (繰り返し実行しても安い)
    assert.equal(looked, 0);
});

test('fill() falls back to the llm only for series the dictionary missed and that have no external id', async () => {
    const db = makeDB([
        // 辞書で引ける → LLM を使わない
        series({ id: 1, title: '作品A' }),
        // 辞書で引けず外部 ID も無い → LLM 対象
        series({ id: 2, title: 'アニメ 作品B 第3話 サブタイトル' }),
        // 辞書で引けないが syobocalTid 済み → LLM 対象外
        series({ id: 3, title: '作品C', syobocalTid: 99 }),
    ]);
    const dict = {
        lookup: async title => {
            if (title === '作品A') return { syobocalTid: 1, annictId: null, title: '作品A', titleKana: null, seasonYear: null, seasonName: null, totalEpisodes: null, matchType: 'exact' };
            if (title === '作品B') return { syobocalTid: 2, annictId: 20, title: '作品B', titleKana: 'さくひんびー', seasonYear: 2025, seasonName: 'SPRING', totalEpisodes: 12, matchType: 'exact' };
            return null;
        },
        lookupEpisodeNumber: async () => null,
    };
    const asked = [];
    const llm = {
        isEnabled: () => true,
        isSuspended: () => false,
        extractWorkTitle: async title => {
            asked.push(title);
            return title === 'アニメ 作品B 第3話 サブタイトル' ? '作品B' : null;
        },
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, llm).fill();

    // 辞書で引けず外部 ID も空だったシリーズだけが LLM へ回る
    // 外部 ID が既に入っているシリーズ (id: 3) は LLM へ回さない
    assert.deepEqual(asked, ['アニメ 作品B 第3話 サブタイトル']);
    assert.equal(result.llmAnalyzed, 1);
    assert.equal(result.llmResolved, 1);
    // 対応をマッチングルールとして学習し、次回以降は LLM を引かずに済むようにする
    assert.deepEqual(db.aliases, [{ normalizedTitle: '作品', seriesId: 2, source: 'llm' }]);
    const patch = db.updates.find(u => u.id === 2).patch;
    assert.equal(patch.syobocalTid, 2);
    assert.equal(patch.annictId, '20');
    assert.equal(patch.seasonSource, 'dictionary');
});

test('fill() does not set an external id when the llm output is not in the dictionary', async () => {
    const db = makeDB([series({ title: '架空アニメ' })]);
    const llm = { isEnabled: () => true, isSuspended: () => false, extractWorkTitle: async () => '存在しない作品' };
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, llm).fill();

    // ハルシネーションは辞書で弾かれるので外部 ID は入らない
    assert.equal(result.llmAnalyzed, 1);
    assert.equal(result.llmResolved, 0);
    assert.equal(db.updates.length, 0);
});

test('fill() keeps going when the llm throws', async () => {
    const db = makeDB([series()]);
    const llm = { isEnabled: () => true, isSuspended: () => false, extractWorkTitle: async () => { throw new Error('boom'); } };
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, llm).fill();

    assert.equal(result.llmResolved, 0);
    assert.equal(result.scanned, 1);
});

test('fill() stops asking the llm once it is suspended (rate limited) and leaves the rest for the next run', async () => {
    const db = makeDB([series({ id: 1, title: 'A' }), series({ id: 2, title: 'B' }), series({ id: 3, title: 'C' })]);
    let asked = 0;
    let suspended = false;
    const llm = {
        isEnabled: () => true,
        isSuspended: () => suspended,
        extractWorkTitle: async () => {
            asked++;
            // 1 件目でレート制限に当たった想定
            suspended = true;
            return null;
        },
    };
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, llm).fill();

    // 休止中に残り 2 件を「抽出できなかった」として消化しない
    assert.equal(asked, 1);
    assert.equal(result.llmAnalyzed, 1);
    assert.equal(result.scanned, 3);
});
