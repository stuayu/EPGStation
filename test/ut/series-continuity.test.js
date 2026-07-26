'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeSeriesContinuity } = require('../../dist/model/series/SeriesContinuity');
const row = (recordedId, episodeNumber, channelId = 1, seasonNumber = 1, startAt) => ({
    recordedId,
    episodeNumber,
    channelId,
    seasonNumber,
    startAt,
});
test('continuity reports missing episodes', () =>
    assert.deepEqual(analyzeSeriesContinuity([row(1, 1), row(3, 3)]).missingEpisodes, [
        { seasonNumber: 1, episodeNumber: 2 },
    ]));
test('continuity groups duplicates', () => {
    const x = analyzeSeriesContinuity([row(1, 2, 10), row(2, 2, 20)]);
    assert.deepEqual(x.duplicateEpisodes[0].channelIds, [10, 20]);
});
test('continuity tracks unknown episodes', () =>
    assert.deepEqual(analyzeSeriesContinuity([row(8, null)]).unknownEpisodeRecordedIds, [8]));

// §4.7: 外部メタデータの放送予定総話数を使って観測済み最大話数を超えて欠番検出する
test('extends missing-episode detection beyond the observed max using external total episode count', () => {
    const rows = [row(1, 1), row(2, 2)];
    const x = analyzeSeriesContinuity(rows, { totalEpisodesBySeason: { 1: 4 } });
    assert.deepEqual(x.missingEpisodes, [
        { seasonNumber: 1, episodeNumber: 3 },
        { seasonNumber: 1, episodeNumber: 4 },
    ]);
});

// §5.4: 未登録局でのみ視聴している作品は放送実績が疎らになりがちなので、録画実績のある局の
// 放送ペースを基準に「現時点までに放送されているはず」の話数までしか欠番として広げない
test('caps missing-episode detection using the recording-observed broadcast pace when no external total is known', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const base = Date.parse('2024-01-01T00:00:00+09:00');
    // 基準局 (channelId=1) は週次ペースで episode 1,2,3 を観測している
    const rows = [
        row(1, 1, 1, 1, base),
        row(2, 2, 1, 1, base + 7 * dayMs),
        row(3, 3, 1, 1, base + 14 * dayMs),
    ];
    // 現在時刻が episode 3 放送直後 (episode 4 はまだ放送されていないはず)
    const now = base + 15 * dayMs;
    const x = analyzeSeriesContinuity(rows, { now });
    assert.deepEqual(x.missingEpisodes, []);
});

test('pace-based estimate extends detection to episodes that should already have aired', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const base = Date.parse('2024-01-01T00:00:00+09:00');
    const rows = [row(1, 1, 1, 1, base), row(2, 2, 1, 1, base + 7 * dayMs)];
    // episode 2 から 3 週間後: 週次ペースなら episode 5 まで放送されているはずなので
    // episode 3, 4, 5 は欠番として検出される
    const now = base + 7 * dayMs + 21 * dayMs;
    const x = analyzeSeriesContinuity(rows, { now });
    assert.deepEqual(x.missingEpisodes, [
        { seasonNumber: 1, episodeNumber: 3 },
        { seasonNumber: 1, episodeNumber: 4 },
        { seasonNumber: 1, episodeNumber: 5 },
    ]);
});
