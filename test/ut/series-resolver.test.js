'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SeriesResolver = require('../../dist/model/series/SeriesResolver').default;
const { titleSimilarity } = require('../../dist/model/series/SeriesResolver');
function memory(candidates = []) {
    let nextSeries = 20,
        nextEpisode = 30;
    const links = new Map(),
        episodes = [];
    return {
        links,
        episodes,
        findCandidates: async () => candidates,
        // 作成したシリーズも検索対象に含める (同じ作品を続けて解決したときに別シリーズが増えないようにする)
        createSeries: async v => {
            const s = { ...v, id: nextSeries++ };
            candidates.push(s);
            return s;
        },
        findEpisode: async (s, se, e) =>
            episodes.find(x => x.seriesId === s && x.seasonNumber === se && x.episodeNumber === e) || null,
        createEpisode: async v => {
            const x = { ...v, id: nextEpisode++ };
            episodes.push(x);
            return x;
        },
        findLink: async id => links.get(id) || null,
        findEpisodeById: async id => episodes.find(x => x.id === id) || null,
        reservationHints: new Map(),
        findReservationHintByReserveId: async function (reserveId) {
            return this.reservationHints.get(reserveId) || null;
        },
        deleteReservationHint: async function (id) {
            for (const [key, value] of this.reservationHints)
                if (value.id === id) this.reservationHints.delete(key);
        },
        countOtherLinksByEpisode: async (episodeId, recordedId) =>
            [...links.values()].filter(x => x.episodeId === episodeId && x.recordedId !== recordedId).length,
        saveLink: async v => {
            const x = { ...v, id: links.get(v.recordedId)?.id || 40 };
            links.set(v.recordedId, x);
            return x;
        },
        findAlias: async () => null,
        findBySyobocalTid: async tid => candidates.find(c => c.syobocalTid === tid) || null,
        findByAnnictId: async id => candidates.find(c => c.annictId === id) || null,
        findByWikidataQid: async qid => candidates.find(c => c.wikidataQid === qid) || null,
        updateExternalMetadata: async () => {},
        fillEpisodeMetadata: async (episodeId, value) => {
            const episode = episodes.find(x => x.id === episodeId);
            if (!episode) return;
            if (typeof value.title === 'string' && episode.title === null) episode.title = value.title;
            if (typeof value.comment === 'string' && episode.comment === null) episode.comment = value.comment;
        },
        upsertPendingMatch: async () => {},
        deletePendingMatchByRecordedId: async () => {},
        getSeries: async id => candidates.find(c => c.id === id) || null,
    };
}
function stubNotification() {
    return { dispatch: async () => {}, test: async () => ({ delivered: [], failed: [] }), processQueue: async () => ({ sent: 0, failed: 0 }), getFailureHistory: async () => [] };
}
// しょぼいカレンダー作品辞書は既定で「該当なし」を返し、従来の類似度判定の挙動を検証できるようにする
function stubTitleDictionary(match = null) {
    return {
        sync: async () => ({ titleCount: 0, lastUpdate: null, lastSyncedAt: null, running: false, error: null, imported: 0, full: false }),
        startAutoSync: () => {},
        lookup: async () => match,
        lookupEpisodeNumber: async () => null,
        // 放送予定 (局 + 時刻) からの引き当ては既定で「該当なし」にし、テストごとに差し替える
        findByIds: async () => null,
        getStatus: async () => ({ titleCount: 0, lastUpdate: null, lastSyncedAt: null, running: false, error: null }),
    };
}
// LLM フォールバックは既定で無効 (設定しない限り呼ばれない)
function stubLlm(extracted = null, enabled = extracted !== null) {
    return { isEnabled: () => enabled, isSuspended: () => false, extractWorkTitle: async () => extracted };
}
// しょぼいカレンダーの放送予定照会。既定では「該当なし」を返す (連携無効の環境と同じ挙動)
function stubProgramLookup(program = null, delayed = null) {
    return {
        calls: [],
        delayedCalls: [],
        // 引けなかった理由も返す ({ match, detail}) 形になっている
        lookup: async function (channelId, startAt) { this.calls.push({ channelId, startAt }); return { match: program, detail: 'テスト' }; },
        // 遅れ放送の照会 (系列キー局の放送予定を作品で絞って引く)。既定は「該当なし」
        lookupDelayed: async function (channelId, startAt, tid) { this.delayedCalls.push({ channelId, startAt, tid }); return delayed; },
    };
}
function resolver(
    db,
    threshold = 0.8,
    notification = stubNotification(),
    titleDictionary = stubTitleDictionary(),
    llm = stubLlm(),
    programLookup = stubProgramLookup(),
) {
    return new SeriesResolver(
        { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) },
        { getAll: async () => ({ series: { matchThreshold: threshold } }) },
        db,
        notification,
        titleDictionary,
        llm,
        programLookup,
    );
}
// 作品辞書の照合結果 (WorkMatch)
function workMatch(overrides = {}) {
    return {
        syobocalTid: 100,
        annictId: null,
        wikidataQid: null,
        tmdbId: null,
        title: '作品名',
        titleKana: null,
        seasonYear: null,
        seasonName: null,
        totalEpisodes: null,
        matchType: 'exact',
        confidence: 1,
        source: 'syobocal',
        ...overrides,
    };
}
test('title similarity handles exact and unrelated titles', () => {
    assert.equal(titleSimilarity('作品名', '作品名'), 1);
    assert.equal(titleSimilarity('作品名', 'ニュース'), 0);
});
test('same programme across stations maps to existing series and episode', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    const link = await resolver(db).resolve({ recordedId: 5, title: '作品名 第3話', channelId: 20, startAt: 100 });
    assert.equal(link.seriesId, 1);
    assert.equal(link.episodeId, 30);
    assert.equal(db.episodes[0].episodeNumber, 3);
});
test('rerun reuses episode and records air type', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    await resolver(db).resolve({ recordedId: 1, title: '作品名 第3話', channelId: 10, startAt: 100 });
    const link = await resolver(db).resolve({
        recordedId: 2,
        title: '【再】作品名 第3話',
        channelId: 20,
        startAt: 200,
    });
    assert.equal(link.episodeId, 30);
    assert.equal(link.airType, 'rerun');
});
test('manual links are never overwritten', async () => {
    const db = memory();
    db.links.set(9, { id: 1, recordedId: 9, seriesId: 99, manualLock: true });
    const link = await resolver(db).resolve({ recordedId: 9, title: '別作品 第1話', channelId: 1, startAt: 1 });
    assert.equal(link.seriesId, 99);
});
test('feature flag keeps resolver disabled', async () => {
    const db = memory();
    const r = new SeriesResolver(
        { getConfig: () => ({ featureFlags: { seriesLibrary: false } }) },
        { getAll: async () => ({}) },
        db,
        stubNotification(),
    );
    assert.equal(await r.resolve({ recordedId: 1, title: 'x', channelId: 1, startAt: 1 }), null);
});

// §4.7: 欠番補完予約提案から作成された予約は、録画完了時にヒントを最優先で使い、
// (通常なら初回放送として first になってしまうはずの) 事前付与された rerun を必ず使う
test('a reservation hint (from a missing-episode proposal) overrides normal scoring/airType detection', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    // episode 2 は他に録画が無い = 通常ロジックなら 'first' になるはずのケース
    const episode = await db.createEpisode({
        seriesId: 1,
        seasonNumber: 1,
        episodeNumber: 2,
        episodeLabel: null,
        title: null,
        airedAt: null,
        createdAt: 1,
        updatedAt: 1,
    });
    db.reservationHints.set(777, { id: 1, reserveId: 777, seriesId: 1, episodeId: episode.id, airType: 'rerun' });

    const link = await resolver(db).resolve({
        recordedId: 5,
        title: '作品名 第2話', // タイトルからは 'unknown' (=> first) になるはずの表記
        channelId: 20,
        startAt: 100,
        reserveId: 777,
    });
    assert.equal(link.seriesId, 1);
    assert.equal(link.episodeId, episode.id);
    assert.equal(link.airType, 'rerun');
    assert.equal(link.matchMethod, 'reservation-hint');
    assert.equal(link.confidence, 1);
    // ヒントは使用後に削除される (二重適用防止)
    assert.equal(await db.findReservationHintByReserveId(777), null);
});

test('resolve() falls back to normal scoring when reserveId has no matching hint', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    const link = await resolver(db).resolve({
        recordedId: 5,
        title: '作品名 第4話',
        channelId: 10,
        startAt: 100,
        reserveId: 999, // ヒント無し
    });
    assert.equal(link.seriesId, 1);
    assert.equal(link.matchMethod, 'title');
});

test('a newly auto-created series gets a cleaned display title (no episode number, casing kept)', async () => {
    const db = memory();
    const created = [];
    const orig = db.createSeries;
    db.createSeries = async v => {
        const s = await orig(v);
        created.push(s);
        return s;
    };
    await resolver(db).resolve({ recordedId: 50, title: 'CLANNAD AFTER STORY(HDマスター版) #16', channelId: 1, startAt: 1 });
    assert.equal(created.length, 1);
    assert.equal(created[0].title, 'CLANNAD AFTER STORY(HDマスター版)');
    assert.equal(created[0].normalizedTitle, 'clannad after story(hdマスター版)');
});

test('llm groups a non-anime programme into an existing series and learns the rule', async () => {
    // バラエティ番組。作品辞書 (アニメのみ) には載らないが、既存シリーズへ束ねたい
    const series = { id: 7, title: 'バナナマンのせっかくグルメ', normalizedTitle: 'バナナマンのせっかくグルメ', preferredChannelId: 10 };
    const db = memory([series]);
    const aliases = [];
    db.upsertAlias = async (normalizedTitle, seriesId, createdAt, source) =>
        aliases.push({ normalizedTitle, seriesId, source });

    const link = await resolver(
        db,
        0.8,
        stubNotification(),
        stubTitleDictionary(),
        stubLlm('バナナマンのせっかくグルメ'),
    ).resolve({
        recordedId: 5,
        title: 'バナナマンのせっかくグルメ★日村が秋田で新米&名物メシを食べまくる2時間SP',
        channelId: 20,
        startAt: 100,
    });

    assert.equal(link.seriesId, 7);
    assert.equal(link.matchMethod, 'llm');
    // 次回以降は LLM を引かずにエイリアスだけで確定できるようにする
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].seriesId, 7);
    assert.equal(aliases[0].source, 'llm');
});

// SCRename と同じ「放送局 + 放送開始時刻」で放送予定を引く経路。
// タイトルの表記に一切依存しないため、辞書キーに当たらないタイトルでも作品と話数が確定する
test('a syobocal programme lookup (channel + start time) resolves the work when the title dictionary misses', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(); // タイトルでは引けない
    dictionary.findByIds = async ids => (ids.syobocalTid === 100 ? workMatch() : null);
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 16, subTitle: '猫猫の推理', comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 5,
        title: '★作品名★', // 話数表記もサブタイトルも無く、局の装飾だけが付いている
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.matchMethod, 'syobocal');
    // 番組の頭から録画できている場合は取り違えの余地がほとんど無いので高い確度を与える
    assert.equal(link.confidence, 0.98);
    // タイトルから取れなかった話数とサブタイトルが放送予定から埋まる
    assert.equal(db.episodes.length, 1);
    assert.equal(db.episodes[0].episodeNumber, 16);
    assert.equal(db.episodes[0].title, '猫猫の推理');
    assert.deepEqual(programLookup.calls[0], { channelId: 20, startAt: 1000 });
});

// 総集編・一挙放送は通し話数を持たないので、サブタイトル照合での逆引きは行わない
// (放送予定側が話数を持っていればそれは正しいので採用する)
test('special programmes (recap / marathon) do not get an episode number from the subtitle fallback', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(workMatch());
    dictionary.lookupEpisodeNumber = async () => 3;
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: null, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 6,
        title: '作品名 総集編',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.episodeId, null);
    assert.equal(db.episodes.length, 0);
});

// 放送予定は局と時刻だけで決まるため録画タイトルの表記より確実。話数表記があっても必ず引き、
// 同じ作品を指していれば放送予定の話数を優先する
test('the programme lookup runs even when the title already has an episode number, and wins', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(workMatch());
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 16, subTitle: '猫猫の推理', comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 7,
        title: '作品名 第3話', // 局が振った通し番号がずれているケース
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(programLookup.calls.length, 1);
    assert.equal(db.episodes[0].episodeNumber, 16);
    assert.equal(db.episodes[0].title, '猫猫の推理');
});

// 放送予定が別作品を指している (時刻ずれ・遅れ放送) 場合は、その話数を持ち込まない
test('a programme lookup pointing at a different work does not override the title episode number', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(workMatch());
    dictionary.lookupEpisodeTitle = async (tid, episodeNumber) => (tid === 100 && episodeNumber === 3 ? '第三話のサブタイトル' : null);
    const programLookup = stubProgramLookup({ tid: 999, count: 99, subTitle: '別作品のサブタイトル', comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: true });

    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 8,
        title: '作品名 第3話',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(db.episodes[0].episodeNumber, 3);
    // サブタイトルもローカルの辞書から引いたものを使う
    assert.equal(db.episodes[0].title, '第三話のサブタイトル');
});

// しょぼいカレンダー未登録の地方局は系列キー局の放送予定で代用する (同時ネットなら同じ作品が並ぶ)。
// 遅れ放送では別番組を指しうるぶん、確度は直接引けた場合より低くする
test('a key station fallback establishes the work with a lower confidence', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(); // タイトルでは引けない
    dictionary.findByIds = async () => workMatch();
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 16, subTitle: '猫猫の推理', comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: true });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 9,
        title: '［字］作品名',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.matchMethod, 'syobocal');
    assert.equal(link.confidence, 0.9);
    assert.equal(db.episodes[0].episodeNumber, 16);
});

test('llm grouping does nothing when the extracted title has no existing series', async () => {
    const series = { id: 7, title: '別番組', normalizedTitle: '別番組', preferredChannelId: 10 };
    const db = memory([series]);
    let learned = 0;
    db.upsertAlias = async () => learned++;

    const link = await resolver(db, 0.8, stubNotification(), stubTitleDictionary(), stubLlm('存在しない番組')).resolve({
        recordedId: 5,
        title: 'まったく別のタイトル',
        channelId: 20,
        startAt: 100,
    });

    // 既存シリーズと完全一致しないので LLM 経由では確定させない (通常のスコアリングへ委ねる)
    assert.notEqual(link?.matchMethod, 'llm');
    assert.equal(learned, 0);
});

// 放送予定の ProgComment を放送回コメントとしてエピソードへ保存する
test('the programme comment from the broadcast schedule is stored on the episode', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(workMatch());
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 5, subTitle: 'サブタイトル', comment: '30分繰り下げ', startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 11,
        title: '作品名',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(db.episodes[0].comment, '30分繰り下げ');
    assert.equal(db.episodes[0].commentSource, 'dictionary');
});

// 既存のエピソードにも後から取れたコメントを補完する (手動編集済みの値は上書きしない)
test('a comment is filled into an existing episode only while it is unset', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(workMatch());
    dictionary.lookupEpisodeTitle = async () => null;
    const first = stubProgramLookup({ tid: 100, count: 5, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });
    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), first).resolve({
        recordedId: 12,
        title: '作品名',
        channelId: 20,
        startAt: 1000,
    });
    assert.equal(db.episodes[0].comment, null);

    const second = stubProgramLookup({ tid: 100, count: 5, subTitle: null, comment: '定刻放送', startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });
    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), second).resolve({
        recordedId: 13,
        title: '作品名',
        channelId: 20,
        startAt: 1000,
    });
    assert.equal(db.episodes[0].comment, '定刻放送');

    // 手動で書き換えた値は自動補完で戻らない
    db.episodes[0].comment = '手動で書いたメモ';
    const third = stubProgramLookup({ tid: 100, count: 5, subTitle: null, comment: '辞書のコメント', startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });
    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), third).resolve({
        recordedId: 14,
        title: '作品名',
        channelId: 20,
        startAt: 1000,
    });
    assert.equal(db.episodes[0].comment, '手動で書いたメモ');
});

// 局と時刻は「その時間に何が放送されていたか」という事実なので、タイトル文字列の照合よりも優先する
test('the programme lookup wins over a conflicting title dictionary match', async () => {
    const db = memory();
    // タイトル照合では TV シリーズ (tid 555) に当たってしまうが、実際に放送されたのは劇場版 (tid 100)
    const dictionary = stubTitleDictionary(workMatch({ syobocalTid: 555, title: '作品名' }));
    dictionary.findByIds = async ids => (ids.syobocalTid === 100 ? workMatch({ title: '劇場版 作品名' }) : null);
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 4, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 20,
        title: '劇場版 作品名',
        channelId: 20,
        startAt: 1000,
    });

    const series = await db.getSeries(link.seriesId);
    assert.equal(series.title, '劇場版 作品名');
    assert.equal(link.confidence, 0.98);
});

// エイリアス (手動修正から学習した対応) よりも放送予定を優先する
test('the programme lookup takes precedence over the alias dictionary', async () => {
    const aliasSeries = { id: 3, title: 'エイリアス先の作品', normalizedTitle: 'えいりあす先の作品', preferredChannelId: 10 };
    const db = memory([aliasSeries]);
    db.findAlias = async () => ({ id: 1, normalizedTitle: '作品名', seriesId: 3, source: 'manual' });
    const dictionary = stubTitleDictionary();
    dictionary.findByIds = async () => workMatch({ title: '作品名' });
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 4, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 21,
        title: '作品名',
        channelId: 20,
        startAt: 1000,
    });

    assert.notEqual(link.seriesId, 3);
    assert.equal(link.matchMethod, 'syobocal');
});

// 手動確定 (manualLock) は放送予定より強い。ユーザーが直した割当を自動判定で覆さない
test('a manually locked link is never replaced by the programme lookup', async () => {
    const db = memory();
    db.links.set(22, { id: 1, recordedId: 22, seriesId: 99, manualLock: true });
    const dictionary = stubTitleDictionary();
    dictionary.findByIds = async () => workMatch();
    const programLookup = stubProgramLookup({ tid: 100, count: 4, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 22,
        title: '作品名',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.seriesId, 99);
    assert.equal(programLookup.calls.length, 0);
});

// 放送時間帯の包含で拾った場合 (録画開始が番組途中) は隣の番組を指す可能性が残るぶん確度を下げる
test('a programme picked by time range containment gets a lower confidence', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary();
    dictionary.findByIds = async () => workMatch();
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 4, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: false, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 23,
        title: '作品名',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.matchMethod, 'syobocal');
    assert.equal(link.confidence, 0.92);
});

// 時刻ずれ・キー局の代用で別番組を拾った場合を弾く (録画タイトルと共通部分が皆無な作品名)
test('a programme whose title shares nothing with the recording is skipped', async () => {
    const series = { id: 5, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 20 };
    const db = memory([series]);
    const dictionary = stubTitleDictionary();
    // 放送予定は隣の番組 (まったく別のタイトル) を指してしまっている
    dictionary.findByIds = async () => workMatch({ title: 'ぜんぜん違う別番組' });
    const programLookup = stubProgramLookup({ tid: 100, count: 4, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 24,
        title: '作品名 第4話',
        channelId: 20,
        startAt: 1000,
    });

    // 放送予定は採用せず、従来の判定 (既存シリーズとの照合) へ委ねる
    assert.equal(link.seriesId, 5);
    assert.equal(link.matchMethod, 'title');
});

// 局が独自表記で送出していても、作品名を含んでいれば放送予定を採用する
test('a programme title contained in the recording title is accepted', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary();
    dictionary.findByIds = async () => workMatch({ title: '薬屋のひとりごと' });
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 4, subTitle: null, comment: null, startAt: 1000, endAt: 2000, exactStart: true, viaKeyStation: false });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 25,
        title: '【日5】薬屋のひとりごと 第4話「牽牛と織女」',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.matchMethod, 'syobocal');
});

test('resolve() records each lookup step into the trace collector when one is passed', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    const trace = [];
    const link = await resolver(db).resolve(
        { recordedId: 5, title: '作品名 第3話', channelId: 10, startAt: 100 },
        trace,
    );

    assert.equal(link.seriesId, 1);
    const steps = trace.map(x => x.step);
    // 判定順どおりに記録される (放送予定 → エイリアス → 作品辞書 → LLM → 類似度)
    assert.deepEqual(steps, [
        'parse',
        'programLookup',
        'alias',
        'workDictionary',
        'llmDictionary',
        'llmGrouping',
        'titleScoring',
    ]);
    assert.equal(trace[trace.length - 1].matched, true);
    // 入力と戻り値の要約がそれぞれ入っている (画面・ログでの追跡用)
    for (const step of trace) {
        assert.equal(typeof step.input, 'string');
        assert.equal(typeof step.output, 'string');
        assert.equal(typeof step.label, 'string');
    }
});

test('resolve() traces the broadcast schedule lookup that決定した作品', async () => {
    const db = memory([]);
    const program = { tid: 100, count: 3, subTitle: 'サブ', comment: null, startAt: 100, endAt: 200, exactStart: true, viaKeyStation: false };
    const dictionary = stubTitleDictionary(null);
    dictionary.findByIds = async () => workMatch({ title: '作品名' });
    const trace = [];
    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), stubProgramLookup(program)).resolve(
        { recordedId: 5, title: '作品名 第3話', channelId: 10, startAt: 100 },
        trace,
    );

    const programStep = trace.find(x => x.step === 'programLookup');
    assert.ok(programStep.output.includes('TID=100'));
    assert.equal(programStep.matched, true);
    const matchStep = trace.find(x => x.step === 'programMatch');
    assert.equal(matchStep.matched, true);
    assert.ok(matchStep.input.includes('syobocalTid=100'));
});

test('resolve() works without a trace collector (default path)', async () => {
    const series = { id: 1, title: '作品名', normalizedTitle: '作品名', preferredChannelId: 10 };
    const db = memory([series]);
    const link = await resolver(db).resolve({ recordedId: 5, title: '作品名 第3話', channelId: 10, startAt: 100 });
    assert.equal(link.seriesId, 1);
});

// しょぼいカレンダー未登録の県域局は、キー局の数日後に同じ作品を流す (遅れネット)。
// 同時刻の照合では拾えないが、作品が確定していればキー局の放送予定を作品で絞って追える
test('resolve() takes the episode number from the key station broadcast for a delayed airing', async () => {
    const db = memory([]);
    const dictionary = stubTitleDictionary(workMatch({ title: '作品名', syobocalTid: 100 }));
    const delayed = {
        tid: 100,
        count: 4,
        subTitle: 'キー局のサブタイトル',
        comment: null,
        startAt: Date.parse('2026-07-26T00:55:00+09:00'),
        endAt: null,
        exactStart: false,
        viaKeyStation: true,
    };
    // その局自身の放送予定は引けない (未登録局) / 遅れ放送だけが引ける
    const programLookup = stubProgramLookup(null, delayed);
    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 5,
        // 話数表記もサブタイトルも無いタイトル
        title: '作品名[字]',
        channelId: 10,
        startAt: Date.parse('2026-08-01T02:06:00+09:00'),
    });

    assert.equal(link.seriesId, 20);
    const episode = db.episodes.find(x => x.id === link.episodeId);
    assert.equal(episode.episodeNumber, 4);
    assert.equal(episode.title, 'キー局のサブタイトル');
    // キー局より後に流れている = 遅れ放送と分かる
    assert.equal(link.airType, 'delayed');
    assert.equal(programLookup.delayedCalls[0].tid, 100);
});

// タイトルから話数が取れる録画では、余計な外部照会を増やさない
test('resolve() does not ask for a delayed broadcast when the episode number is already known', async () => {
    const db = memory([]);
    const dictionary = stubTitleDictionary(workMatch({ title: '作品名', syobocalTid: 100 }));
    const programLookup = stubProgramLookup(null, null);
    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 5,
        title: '作品名 第3話',
        channelId: 10,
        startAt: 1000,
    });

    assert.equal(programLookup.delayedCalls.length, 0);
});
