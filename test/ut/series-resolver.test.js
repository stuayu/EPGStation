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
        createSeries: async v => ({ ...v, id: nextSeries++ }),
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
        fillEpisodeTitle: async (episodeId, title) => {
            const episode = episodes.find(x => x.id === episodeId);
            if (episode && episode.title === null) episode.title = title;
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
        getStatus: async () => ({ titleCount: 0, lastUpdate: null, lastSyncedAt: null, running: false, error: null }),
    };
}
// LLM フォールバックは既定で無効 (設定しない限り呼ばれない)
function stubLlm(extracted = null, enabled = extracted !== null) {
    return { isEnabled: () => enabled, isSuspended: () => false, extractWorkTitle: async () => extracted };
}
// しょぼいカレンダーの放送予定照会。既定では「該当なし」を返す (連携無効の環境と同じ挙動)
function stubProgramLookup(program = null) {
    return { calls: [], lookup: async function (channelId, startAt) { this.calls.push({ channelId, startAt }); return program; } };
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
    const programLookup = stubProgramLookup({ tid: 100, count: 16, subTitle: '猫猫の推理', startAt: 1000, endAt: 2000 });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 5,
        title: '局独自の表記だけのタイトル', // 話数表記もサブタイトルも無い
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.matchMethod, 'syobocal');
    // 放送予定は時刻ずれで隣の番組を拾う余地があるため、確度はタイトル照合より低く抑える
    assert.equal(link.confidence, 0.95);
    // タイトルから取れなかった話数とサブタイトルが放送予定から埋まる
    assert.equal(db.episodes.length, 1);
    assert.equal(db.episodes[0].episodeNumber, 16);
    assert.equal(db.episodes[0].title, '猫猫の推理');
    assert.deepEqual(programLookup.calls[0], { channelId: 20, startAt: 1000 });
});

// 総集編・一挙放送は通し話数を持たないので、放送予定やサブタイトル照合で話数を付けない
test('special programmes (recap / marathon) do not get an episode number from the fallbacks', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(workMatch());
    dictionary.lookupEpisodeNumber = async () => 3;
    dictionary.lookupEpisodeTitle = async () => null;
    const programLookup = stubProgramLookup({ tid: 100, count: 3, subTitle: null, startAt: 1000, endAt: 2000 });

    const link = await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 6,
        title: '作品名 総集編',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(link.episodeId, null);
    assert.equal(db.episodes.length, 0);
});

// 明示的な話数表記がある録画では、話数のためだけに外部へ問い合わせない
test('an explicit episode number in the title skips the programme lookup', async () => {
    const db = memory();
    const dictionary = stubTitleDictionary(workMatch());
    dictionary.lookupEpisodeTitle = async (tid, episodeNumber) => (tid === 100 && episodeNumber === 3 ? '第三話のサブタイトル' : null);
    const programLookup = stubProgramLookup({ tid: 100, count: 99, subTitle: null, startAt: 1000, endAt: 2000 });

    await resolver(db, 0.8, stubNotification(), dictionary, stubLlm(), programLookup).resolve({
        recordedId: 7,
        title: '作品名 第3話',
        channelId: 20,
        startAt: 1000,
    });

    assert.equal(programLookup.calls.length, 0);
    assert.equal(db.episodes[0].episodeNumber, 3);
    // サブタイトルはローカルの辞書から補完される (外部通信は伴わない)
    assert.equal(db.episodes[0].title, '第三話のサブタイトル');
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
