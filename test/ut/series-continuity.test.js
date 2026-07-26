'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeSeriesContinuity } = require('../../dist/model/series/SeriesContinuity');
const row = (recordedId, episodeNumber, channelId = 1, seasonNumber = 1) => ({
    recordedId,
    episodeNumber,
    channelId,
    seasonNumber,
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
