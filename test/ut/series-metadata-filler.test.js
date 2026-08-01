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
        comments: [],
        updateSeriesComment: async function (id, comment, source) {
            this.comments.push({ id, comment, source });
            return true;
        },
    };
}
const emptyDict = { lookup: async () => null, lookupEpisodeNumber: async () => null };
const noLlm = { isEnabled: () => false, isSuspended: () => false, extractWorkTitle: async () => null };
// 作品コメントは既定で「取得できない」ことにし、コメント取得は専用のテストでのみ検証する
const noComment = { fetchComment: async () => null };

function series(over = {}) {
    return {
        id: 1,
        title: '作品',
        titleSource: null,
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
        comment: null,
        commentSource: null,
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
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill();

    assert.equal(result.updated, 1);
    assert.deepEqual(db.updates[0].patch, {
        // 表示名は辞書名と同じなので、以後引き直さないよう出所だけ記録する
        titleSource: 'dictionary',
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
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, noComment).fill();

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
        await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, noComment).fill();
        assert.equal(db.updates[0].patch.seasonName, expected, iso);
    }
});

test('fill() never overwrites a manually set season', async () => {
    const db = makeDB(
        [series({ seasonYear: 2020, seasonName: 'SPRING', seasonSource: 'manual', titleKana: 'x', totalEpisodes: 1, syobocalTid: 1, annictId: '1', titleSource: 'dictionary' })],
        new Map([[1, Date.parse('2024-11-05T21:00:00+09:00')]]),
    );
    const dict = {
        lookup: async () => ({
            syobocalTid: 10,
            annictId: 20,
            wikidataQid: null,
            tmdbId: null,
            title: '作品',
            titleKana: 'さくひん',
            seasonYear: 2024,
            seasonName: 'AUTUMN',
            totalEpisodes: 12,
        }),
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill();

    // 手動設定のクールは辞書の値で上書きしない (タイトル同期以外の変更が無い)
    assert.equal(result.updated, 0);
    assert.equal(db.updates.length, 0);
});

test('fill() leaves the season unset when there is neither a match nor a recording', async () => {
    const db = makeDB([series()], new Map());
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, noComment).fill();

    assert.equal(result.updated, 0);
});

test('fill() skips series that already have everything', async () => {
    const db = makeDB([
        series({ titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', seasonSource: 'dictionary', totalEpisodes: 12, syobocalTid: 1, annictId: '2', titleSource: 'dictionary' }),
    ]);
    let looked = 0;
    // 表示名を辞書名へ合わせ続けるため辞書 (メモリ索引) だけは引くが、同じ名前なら何も更新しない
    const dict = {
        lookup: async () => {
            looked++;
            return { syobocalTid: 1, annictId: 2, wikidataQid: null, tmdbId: null, title: '作品', titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', totalEpisodes: 12 };
        },
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill();

    assert.equal(result.updated, 0);
    assert.equal(db.updates.length, 0);
    assert.equal(looked, 1);
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
    const result = await new SeriesMetadataFiller(logger, config, db, dict, llm, noComment).fill();

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
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, llm, noComment).fill();

    // ハルシネーションは辞書で弾かれるので外部 ID は入らない
    assert.equal(result.llmAnalyzed, 1);
    assert.equal(result.llmResolved, 0);
    assert.equal(db.updates.length, 0);
});

test('fill() keeps going when the llm throws', async () => {
    const db = makeDB([series()]);
    const llm = { isEnabled: () => true, isSuspended: () => false, extractWorkTitle: async () => { throw new Error('boom'); } };
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, llm, noComment).fill();

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
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, llm, noComment).fill();

    // 休止中に残り 2 件を「抽出できなかった」として消化しない
    assert.equal(asked, 1);
    assert.equal(result.llmAnalyzed, 1);
    assert.equal(result.scanned, 3);
});

// 作品コメントは辞書本体に含めず TID 指定で個別に引く (1 作品あたり数 KB あるため)
test('fill() fetches the work comment for series that have a syobocal tid', async () => {
    const db = makeDB([series({ syobocalTid: 42, titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', seasonSource: 'dictionary', totalEpisodes: 12, annictId: '2' })]);
    const asked = [];
    const comment = { fetchComment: async tid => { asked.push(tid); return '*リンク\n-[[公式 https://example.com/]]'; } };
    await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, comment).fill();

    assert.deepEqual(asked, [42]);
    assert.equal(db.comments.length, 1);
    assert.equal(db.comments[0].id, 1);
    assert.equal(db.comments[0].source, 'dictionary');
});

// 手動で編集・削除したコメントは自動取得で書き戻さない
test('fill() never overwrites a manually edited comment', async () => {
    const db = makeDB([series({ syobocalTid: 42, commentSource: 'manual', titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', seasonSource: 'dictionary', totalEpisodes: 12, annictId: '2' })]);
    let asked = 0;
    const comment = { fetchComment: async () => { asked++; return 'コメント'; } };
    await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, comment).fill();

    assert.equal(asked, 0);
    assert.equal(db.comments.length, 0);
});

// コメントだけが未取得のシリーズでは作品辞書を引き直さない (コメントは辞書本体に無いため)
test('fill() does not re-query the work dictionary when only the comment is missing', async () => {
    const db = makeDB([
        series({ syobocalTid: 42, titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', seasonSource: 'dictionary', totalEpisodes: 12, annictId: '2', titleSource: 'dictionary' }),
    ]);
    let looked = 0;
    const dict = { lookup: async () => { looked++; return null; }, lookupEpisodeNumber: async () => null };
    await new SeriesMetadataFiller(logger, config, db, dict, noLlm, { fetchComment: async () => 'コメント' }).fill();

    // 表示名の同期のために 1 度だけ引く (外部通信は伴わない)。コメントは別経路で取得される
    assert.equal(looked, 1);
    assert.equal(db.comments.length, 1);
});

// TID が無いシリーズはコメントを引けない
test('fill() skips the comment fetch for series without a syobocal tid', async () => {
    const db = makeDB([series({ titleKana: 'x', seasonYear: 2024, seasonName: 'AUTUMN', seasonSource: 'dictionary', totalEpisodes: 12, syobocalTid: null, annictId: '2' })]);
    let asked = 0;
    const comment = { fetchComment: async () => { asked++; return 'コメント'; } };
    await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, comment).fill();

    assert.equal(asked, 0);
});

// 作品コメントは 1 作品ごとに外部へ問い合わせるため 1 回では取り切れない。
// 「取れた / 引けない / 次回へ繰り越し」の内訳を返し、画面とログで進捗を追えるようにする
test('fill() reports the breakdown of comment fetching', async () => {
    // TID 付き 2 件 (コメント取得対象) と TID 無し 1 件 (引けない)
    const list = [
        series({ id: 1, syobocalTid: 100, annictId: 'a', titleKana: 'か', totalEpisodes: 1, seasonYear: 2024, seasonName: 'AUTUMN' }),
        series({ id: 2, syobocalTid: 200, annictId: 'a', titleKana: 'か', totalEpisodes: 1, seasonYear: 2024, seasonName: 'AUTUMN' }),
        series({ id: 3, syobocalTid: null, annictId: 'a', titleKana: 'か', totalEpisodes: 1, seasonYear: 2024, seasonName: 'AUTUMN' }),
    ];
    const db = makeDB(list);
    const comment = { fetchComment: async tid => (tid === 100 ? 'コメント本文' : null) };
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, comment).fill();

    assert.equal(result.commentFetched, 2);
    assert.equal(result.commentFilled, 1);
    assert.equal(result.commentSkippedNoTid, 1);
    assert.equal(result.commentPending, 0);
    assert.deepEqual(db.comments, [{ id: 1, comment: 'コメント本文', source: 'dictionary' }]);
});

test('fill() does not fetch a comment that was edited by hand', async () => {
    const db = makeDB([
        series({ syobocalTid: 100, annictId: 'a', titleKana: 'か', totalEpisodes: 1, seasonYear: 2024, seasonName: 'AUTUMN', comment: null, commentSource: 'manual' }),
    ]);
    let called = 0;
    const comment = {
        fetchComment: async () => {
            called++;
            return 'コメント本文';
        },
    };
    const result = await new SeriesMetadataFiller(logger, config, db, emptyDict, noLlm, comment).fill();

    assert.equal(called, 0);
    assert.equal(result.commentFetched, 0);
    assert.equal(db.comments.length, 0);
});

test('fill() overwrites the series title with the official one from the work dictionary', async () => {
    const db = makeDB([series({ title: '作品 (再放送)' })]);
    const dict = {
        lookup: async () => ({
            syobocalTid: 10,
            annictId: null,
            wikidataQid: null,
            tmdbId: null,
            title: '作品',
            titleKana: null,
            seasonYear: null,
            seasonName: null,
            totalEpisodes: null,
        }),
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill();

    assert.equal(result.titleSynced, 1);
    assert.equal(db.updates[0].patch.title, '作品');
    assert.equal(db.updates[0].patch.titleSource, 'dictionary');
});

test('fill() keeps a manually edited title', async () => {
    const db = makeDB([series({ title: '手動で付けた名前', titleSource: 'manual' })]);
    const dict = {
        lookup: async () => ({
            syobocalTid: 10,
            annictId: null,
            wikidataQid: null,
            tmdbId: null,
            title: '作品',
            titleKana: null,
            seasonYear: null,
            seasonName: null,
            totalEpisodes: null,
        }),
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill();

    assert.equal(result.titleSynced, 0);
    assert.equal(typeof db.updates[0]?.patch.title, 'undefined');
    assert.equal(typeof db.updates[0]?.patch.titleSource, 'undefined');
});

test('fill() with seriesIds only touches the specified series', async () => {
    const db = makeDB([series({ id: 1 }), series({ id: 2, title: '別作品', normalizedTitle: '別作品' })]);
    const dict = {
        lookup: async () => ({
            syobocalTid: 10,
            annictId: null,
            wikidataQid: null,
            tmdbId: null,
            title: '作品',
            titleKana: null,
            seasonYear: null,
            seasonName: null,
            totalEpisodes: null,
        }),
        lookupEpisodeNumber: async () => null,
    };
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill({ seriesIds: [2] });

    assert.equal(result.scanned, 1);
    assert.deepEqual(
        db.updates.map(x => x.id),
        [2],
    );
});

test('fill() with force overwrites values that are already filled in', async () => {
    const db = makeDB([
        series({
            syobocalTid: 1,
            annictId: '2',
            titleKana: 'ふるいよみ',
            totalEpisodes: 1,
            seasonYear: 2000,
            seasonName: 'WINTER',
            seasonSource: 'estimated',
        }),
    ]);
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
    const result = await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill({
        seriesIds: [1],
        force: true,
    });

    assert.equal(result.updated, 1);
    assert.equal(db.updates[0].patch.syobocalTid, 10);
    assert.equal(db.updates[0].patch.annictId, '20');
    assert.equal(db.updates[0].patch.titleKana, 'さくひん');
    assert.equal(db.updates[0].patch.totalEpisodes, 12);
    assert.equal(db.updates[0].patch.seasonYear, 2024);
});

test('fill() with force still keeps a manually set season and title', async () => {
    const db = makeDB([
        series({
            title: '手動で付けた名前',
            titleSource: 'manual',
            seasonYear: 2000,
            seasonName: 'WINTER',
            seasonSource: 'manual',
        }),
    ]);
    const dict = {
        lookup: async () => ({
            syobocalTid: 10,
            annictId: null,
            wikidataQid: null,
            tmdbId: null,
            title: '作品',
            titleKana: null,
            seasonYear: 2024,
            seasonName: 'AUTUMN',
            totalEpisodes: null,
        }),
        lookupEpisodeNumber: async () => null,
    };
    await new SeriesMetadataFiller(logger, config, db, dict, noLlm, noComment).fill({ seriesIds: [1], force: true });

    assert.equal(typeof db.updates[0]?.patch.title, 'undefined');
    assert.equal(typeof db.updates[0]?.patch.seasonYear, 'undefined');
});
