'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const WorkDictionary = require('../../dist/model/series/WorkDictionary').default;
// 照合キーは実装と同じ関数で作る (手書きするとゆれて実態と食い違うため)
const { syobocalLookupKey, strictProgramKey } = require('../../dist/model/series/SeriesNormalizer');

// --- しょぼいカレンダー辞書のインメモリスタブ ---
function makeSyobocalDB(titles = [], episodesByTid = {}) {
    const map = new Map(titles.map(t => [t.tid, t]));
    return {
        count: async () => map.size,
        getLatestLastUpdate: async () => '2026-07-01 00:00:00',
        listAllAliases: async () =>
            titles.flatMap(t => [
                { lookupKey: t.lookupKey, tid: t.tid, rank: 0 },
                ...(t.aliases ?? []).map(a => ({ lookupKey: a, tid: t.tid, rank: 1 })),
            ]),
        // 続編 (期) のグループ構築用。firstYear/firstMonth を持つ作品だけが期の選び直しの対象になる
        listSeasons: async () =>
            titles.map(t => ({
                tid: t.tid,
                lookupKey: t.lookupKey,
                firstYear: t.firstYear ?? null,
                firstMonth: t.firstMonth ?? null,
                totalEpisodes: t.totalEpisodes ?? null,
            })),
        get: async tid => map.get(tid) ?? null,
        listEpisodes: async tid => episodesByTid[tid] ?? [],
    };
}

// --- Annict 辞書のインメモリスタブ ---
// Wikidata 辞書は既定で空 (アニメ辞書だけの従来挙動を検証できるようにする)
function makeWikidataDB(programs = []) {
    return {
        count: async () => programs.length,
        countLinkedToSyobocal: async () => programs.filter(x => x.syobocalTid != null).length,
        listAllAliases: async () =>
            programs.map(x => ({ strictKey: x.strictKey, qid: x.qid, rank: 0, syobocalTid: x.syobocalTid ?? null })),
        get: async qid => programs.find(x => x.qid === qid) ?? null,
        bulkUpsert: async () => {},
        clear: async () => {},
    };
}
function makeAnnictDB(works = []) {
    const map = new Map(works.map(w => [w.annictId, w]));
    return {
        count: async () => map.size,
        countLinkedToSyobocal: async () => works.filter(w => w.syobocalTid !== null).length,
        listAllAliases: async () =>
            works.flatMap(w => [
                { lookupKey: w.lookupKey, annictId: w.annictId, rank: 0, syobocalTid: w.syobocalTid },
                ...(w.aliases ?? []).map(a => ({
                    lookupKey: a,
                    annictId: w.annictId,
                    rank: 2,
                    syobocalTid: w.syobocalTid,
                })),
            ]),
        get: async id => map.get(id) ?? null,
        findBySyobocalTid: async tid => works.find(w => w.syobocalTid === tid) ?? null,
    };
}

function syobocalTitle({ tid, title, aliases = [], totalEpisodes = null, firstYear = null, firstMonth = null }) {
    return {
        tid,
        title,
        lookupKey: syobocalLookupKey(title),
        aliases: aliases.map(syobocalLookupKey),
        totalEpisodes,
        firstYear,
        firstMonth,
    };
}
function annictWork({ annictId, title, aliases = [], syobocalTid = null, episodesCount = null }) {
    return {
        annictId,
        title,
        lookupKey: syobocalLookupKey(title),
        aliases: aliases.map(syobocalLookupKey),
        syobocalTid,
        episodesCount,
    };
}

test('lookup() matches across punctuation, dash and quote variants', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 1, title: 'ざつ旅-That’s Journey-' })]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    for (const recorded of [
        'ざつ旅-That’s Journey- 第1旅',
        "ざつ旅-That's Journey-",
        'ざつ旅―that’s journey― 第2旅',
        'ざつ旅 ―That′s Journey―',
    ]) {
        const match = await dict.lookup(recorded);
        assert.notEqual(match, null, recorded);
        assert.equal(match.syobocalTid, 1, recorded);
    }
});

test('lookup() strips broadcast block prefixes, frame names and episode markers', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([
            syobocalTitle({ tid: 10, title: '呪術廻戦' }),
            syobocalTitle({ tid: 11, title: '薬屋のひとりごと' }),
            syobocalTitle({ tid: 12, title: 'MFゴースト 2nd Season' }),
            syobocalTitle({ tid: 13, title: 'ハイガクラ' }),
        ]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    const cases = [
        ['[字]アニメ　呪術廻戦　第19話　黒閃', 10],
        // 括弧で囲まれない末尾の放送枠名も落とす (枠ごとに別シリーズへ分裂するのを防ぐ)
        ['薬屋のひとりごと FRIDAY ANIME NIGHT', 11],
        ['TVアニメ『MFゴースト』2nd Season　＃19「ロンサムカウボーイ」', 12],
        ['ハイガクラ　★漆話「暴龍之舞」', 13],
    ];
    for (const [recorded, tid] of cases) {
        const match = await dict.lookup(recorded);
        assert.notEqual(match, null, recorded);
        assert.equal(match.syobocalTid, tid, recorded);
    }
});

test('lookup() restores titles truncated by the EPG length limit via prefix matching', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 1, title: 'SAKAMOTO DAYS' })]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    const match = await dict.lookup('SAKAMOTO');
    assert.notEqual(match, null);
    assert.equal(match.syobocalTid, 1);
    assert.equal(match.matchType, 'prefix');
});

test('lookup() falls back to an Annict-only work when the title is missing from syobocal', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([]),
        makeAnnictDB([
            annictWork({ annictId: 500, title: '配信限定作品', episodesCount: 12 }),
        ]),
        makeWikidataDB(),
    );

    const match = await dict.lookup('配信限定作品 第3話');
    assert.notEqual(match, null);
    assert.equal(match.syobocalTid, null);
    assert.equal(match.annictId, 500);
    assert.equal(match.source, 'annict');
    assert.equal(match.totalEpisodes, 12);
});

test('lookup() merges a syobocal title and an Annict work that share a syobocalTid', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 7, title: '銀河英雄伝説 Die Neue These' })]),
        makeAnnictDB([
            annictWork({
                annictId: 900,
                title: '銀河英雄伝説 Die Neue These',
                aliases: ['ginganeiudensetsudieneuethese'],
                syobocalTid: 7,
            }),
        ]),
        makeWikidataDB(),
    );

    // Annict 側の英題キーで引いても、しょぼいカレンダーの TID と正式タイトルが返る
    const match = await dict.lookup('Ginga Neiu Densetsu Die Neue These');
    assert.notEqual(match, null);
    assert.equal(match.syobocalTid, 7);
    assert.equal(match.annictId, 900);
    assert.equal(match.source, 'syobocal');
    assert.equal(match.title, '銀河英雄伝説 Die Neue These');
});

test('lookup() strips leading frame names that contain spaces or are followed by a bracket', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([
            syobocalTitle({ tid: 1, title: '神様はじめました' }),
            syobocalTitle({ tid: 2, title: 'よわよわ先生' }),
            syobocalTitle({ tid: 3, title: '凍牌' }),
        ]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    const cases = [
        // 冠の中に空白を含む ("SEIBU TRAIN アニメスペシャル・")
        ['ＳＥＩＢＵ　ＴＲＡＩＮ　アニメスペシャル・神様はじめました[Ｓ][新]', 1],
        // 「アニメ」の直後が括弧 ("水曜アニメ<水もん>")
        ['[新]水曜アニメ＜水もん＞よわよわ先生 #1', 2],
        // 話数表記を除いた後に残る装飾記号 (▼)
        ['アニメ・凍牌▼第８話　決死', 3],
    ];
    for (const [recorded, tid] of cases) {
        const match = await dict.lookup(recorded);
        assert.notEqual(match, null, recorded);
        assert.equal(match.syobocalTid, tid, recorded);
    }
});

test('lookup() uses the quoted work name when the title is "frame name + 「work」"', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([
            syobocalTitle({ tid: 1, title: 'ウィッチウォッチ' }),
            syobocalTitle({ tid: 2, title: '鬼滅の刃' }),
        ]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    assert.equal((await dict.lookup('日５「ウィッチウォッチ」　♯２[字][デ]')).syobocalTid, 1);
    assert.equal((await dict.lookup('テレビアニメ「鬼滅の刃」シリーズ全編再放送＃２[字][解]')).syobocalTid, 2);
});

test('lookup() does not take a quoted title that a drama marker precedes', async () => {
    // 同名のアニメ作品へ実写ドラマを誤って寄せない
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 1, title: 'Gift ～ギフト～ eternal rainbow' })]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    assert.equal(await dict.lookup('[新]和田琢磨・染谷俊之W主演ドラマ「gift」第１話「giftという名の能力」'), null);
});

test('lookup() ignores a trailing reading in parentheses', async () => {
    const dict = new WorkDictionary(makeSyobocalDB([syobocalTitle({ tid: 1, title: '羅小黒戦記' })]), makeAnnictDB(), makeWikidataDB());

    assert.equal((await dict.lookup('[新]羅小黒戦記（ロシャオヘイセンキ）　＃１')).syobocalTid, 1);
});

test('lookup() folds latin diacritics but keeps Japanese voiced sound marks', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 1, title: 'Übel Blatt' }), syobocalTitle({ tid: 2, title: 'ざつ旅' })]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    assert.equal((await dict.lookup('[新]アニメ　Ubel Blatt～ユーベルブラット～　第01話')).syobocalTid, 1);
    // 濁点は U+3099 で発音記号の範囲外なので、別作品に化けたりしない
    assert.equal((await dict.lookup('ざつ旅 第1旅')).syobocalTid, 2);
});

test('lookup() does not match an unrelated programme', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 1, title: '呪術廻戦' })]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    assert.equal(await dict.lookup('バナナマンのせっかくグルメ★日村が秋田で新米を食べまくる２時間SP'), null);
});

test('lookup() returns null while both dictionaries are empty', async () => {
    const dict = new WorkDictionary(makeSyobocalDB([]), makeAnnictDB([]), makeWikidataDB());
    assert.equal(await dict.lookup('呪術廻戦 第1話'), null);
});

test('lookupEpisodeNumber() recovers the episode number from a sub title', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 1, title: '作品タイトル' })], {
            1: [
                { tid: 1, episodeNumber: 1, subTitle: 'はじまりの朝', lookupKey: syobocalLookupKey('はじまりの朝') },
                { tid: 1, episodeNumber: 2, subTitle: 'ふたつめの夜', lookupKey: syobocalLookupKey('ふたつめの夜') },
            ],
        }),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    assert.equal(await dict.lookupEpisodeNumber(1, '作品タイトル「ふたつめの夜」'), 2);
    assert.equal(await dict.lookupEpisodeNumber(1, '作品タイトル「知らないサブタイトル」'), null);
});

test('lookup() prefers the syobocal total episode count over the Annict one', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 3, title: '作品', totalEpisodes: 24 })]),
        makeAnnictDB([annictWork({ annictId: 1, title: '作品', syobocalTid: 3, episodesCount: 12 })]),
        makeWikidataDB(),
    );

    const match = await dict.lookup('作品 第1話');
    assert.equal(match.totalEpisodes, 24);
});

test('lookup() finds a non-anime programme through the wikidata dictionary (exact key only)', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB(),
        makeAnnictDB(),
        makeWikidataDB([{ qid: 'Q11269387', title: 'じゃじゃじゃTV', strictKey: strictProgramKey('じゃじゃじゃTV'), syobocalTid: null, tmdbId: null }]),
    );
    const match = await dict.lookup('じゃじゃじゃTV');

    assert.equal(match.wikidataQid, 'Q11269387');
    assert.equal(match.source, 'wikidata');
    assert.equal(match.matchType, 'exact');
    assert.equal(match.syobocalTid, null);
});

test('lookup() does not let the wikidata dictionary match by containment', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB(),
        makeAnnictDB(),
        makeWikidataDB([{ qid: 'Q1', title: 'パラダイス', strictKey: strictProgramKey('パラダイス'), syobocalTid: null, tmdbId: null }]),
    );
    // 一般番組は短く一般的なタイトルが多いため、含有一致を許すと別番組へ誤リンクする
    assert.equal(await dict.lookup('ゲームパラダイス'), null);
});

test('lookup() does not duplicate a work that both syobocal and wikidata have (joined by P11648)', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([syobocalTitle({ tid: 42, title: '作品名' })]),
        makeAnnictDB(),
        makeWikidataDB([{ qid: 'Q99', title: '作品名', strictKey: strictProgramKey('作品名'), syobocalTid: 42, tmdbId: 7 }]),
    );
    const match = await dict.lookup('作品名');

    // しょぼいカレンダー側の作品として解決し、Wikidata の qid はそこへ併記される
    assert.equal(match.syobocalTid, 42);
    assert.equal(match.source, 'syobocal');
    assert.equal(match.wikidataQid, 'Q99');
});

// 局によっては「株式会社マジルミエ[字]」のように期の表記を送出しないため、タイトル照合だけでは
// 常に第 1 期へ寄ってしまう。放送日時を渡した場合はその日時に合う期を選ぶ
test('lookup() picks the season whose broadcast period contains the recording', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([
            syobocalTitle({ tid: 7181, title: '株式会社マジルミエ', totalEpisodes: 12, firstYear: 2024, firstMonth: 10 }),
            syobocalTitle({ tid: 7892, title: '株式会社マジルミエ(第2期)', totalEpisodes: 12, firstYear: 2026, firstMonth: 7 }),
        ]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    // 2026-08-01 の録画 → 第 2 期
    const second = await dict.lookup('株式会社マジルミエ[字]', Date.parse('2026-08-01T02:06:00+09:00'));
    assert.equal(second.syobocalTid, 7892);
    assert.equal(second.title, '株式会社マジルミエ(第2期)');

    // 2024-12-06 の録画 → 第 1 期
    const first = await dict.lookup('株式会社マジルミエ[字]', Date.parse('2024-12-06T23:00:00+09:00'));
    assert.equal(first.syobocalTid, 7181);

    // 放送日時を渡さなければ従来どおりタイトル照合の結果 (期表記の無い第 1 期) を返す
    const noDate = await dict.lookup('株式会社マジルミエ[字]');
    assert.equal(noDate.syobocalTid, 7181);
});

test('lookup() keeps the matched work when no season period contains the recording', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([
            syobocalTitle({ tid: 7181, title: '株式会社マジルミエ', totalEpisodes: 12, firstYear: 2024, firstMonth: 10 }),
            syobocalTitle({ tid: 7892, title: '株式会社マジルミエ(第2期)', totalEpisodes: 12, firstYear: 2026, firstMonth: 7 }),
        ]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    // どの期の放送期間にも入らない日時 (期の間) では選び直さない
    const match = await dict.lookup('株式会社マジルミエ[字]', Date.parse('2025-06-01T00:00:00+09:00'));
    assert.equal(match.syobocalTid, 7181);
});

test('lookup() does not switch seasons for a work that has only one season', async () => {
    const dict = new WorkDictionary(
        makeSyobocalDB([
            syobocalTitle({ tid: 1, title: '単発作品', totalEpisodes: 12, firstYear: 2024, firstMonth: 10 }),
        ]),
        makeAnnictDB(),
        makeWikidataDB(),
    );

    const match = await dict.lookup('単発作品', Date.parse('2026-08-01T00:00:00+09:00'));
    assert.equal(match.syobocalTid, 1);
});
