'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const MissingEpisodeApiModel = require('../../dist/model/api/series/MissingEpisodeApiModel').default;
const { parseSeriesInfo } = require('../../dist/model/series/SeriesNormalizer');

const enabledConfig = { getConfig: () => ({ featureFlags: { seriesLibrary: true } }) };
const disabledConfig = { getConfig: () => ({ featureFlags: { seriesLibrary: false } }) };

function makeSeriesDB() {
    const series = {
        id: 1,
        title: '対象作品',
        normalizedTitle: parseSeriesInfo('対象作品').normalizedTitle,
        annictId: null,
        syobocalTid: null,
    };
    const episodes = [];
    let nextEpisodeId = 100;
    return {
        getSeries: async id => (id === 1 ? series : null),
        listRecorded: async () => [
            { recordedId: 1, channelId: 1, episodeId: 1, seasonNumber: 1, episodeNumber: 1, startAt: 0 },
            { recordedId: 2, channelId: 1, episodeId: 2, seasonNumber: 1, episodeNumber: 3, startAt: 0 },
        ],
        findEpisode: async (seriesId, seasonNumber, episodeNumber) =>
            episodes.find(e => e.seriesId === seriesId && e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber) ??
            null,
        createEpisode: async value => {
            const created = { ...value, id: nextEpisodeId++ };
            episodes.push(created);
            return created;
        },
        savedHints: [],
        saveReservationHint: async function (value) {
            this.savedHints.push(value);
            return { id: 1, ...value };
        },
    };
}

function makeProgramDB(matchingProgram) {
    return {
        findId: async id => (matchingProgram && id === matchingProgram.id ? matchingProgram : null),
        findRule: async () => (matchingProgram ? [matchingProgram] : []),
    };
}

test('feature flag off: listProposals throws SeriesLibraryFeatureIsDisabled and touches nothing', async () => {
    const seriesDB = makeSeriesDB();
    const model = new MissingEpisodeApiModel(disabledConfig, seriesDB, makeProgramDB(null), {}, {});
    await assert.rejects(() => model.listProposals(1), /SeriesLibraryFeatureIsDisabled/);
});

test('finds a future rerun candidate on the EPG for a missing episode (episode 2 is missing between 1 and 3)', async () => {
    const future = {
        id: 555,
        channelId: 2,
        name: '対象作品 第2話',
        startAt: Date.now() + 24 * 60 * 60 * 1000,
        endAt: Date.now() + 25 * 60 * 60 * 1000,
    };
    const seriesDB = makeSeriesDB();
    const model = new MissingEpisodeApiModel(enabledConfig, seriesDB, makeProgramDB(future), {}, {});
    const proposals = await model.listProposals(1);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].episodeNumber, 2);
    assert.equal(proposals[0].candidates[0].programId, 555);
});

test('reserveProposal creates a reservation and pre-tags it with a rerun hint for SeriesResolver to consume', async () => {
    const program = { id: 555, channelId: 2, name: '対象作品 第2話', startAt: 1, endAt: 2 };
    const seriesDB = makeSeriesDB();
    const reserveApi = { add: async () => 999 };
    const model = new MissingEpisodeApiModel(enabledConfig, seriesDB, makeProgramDB(program), reserveApi, {});
    const reserveId = await model.reserveProposal(1, 1, 2, 555);
    assert.equal(reserveId, 999);
    assert.equal(seriesDB.savedHints.length, 1);
    assert.equal(seriesDB.savedHints[0].reserveId, 999);
    assert.equal(seriesDB.savedHints[0].airType, 'rerun');
});

test('reserveProposal throws ProgramIsNotFound for an unknown programId (and never calls reserve.add)', async () => {
    const seriesDB = makeSeriesDB();
    const reserveApi = {
        add: async () => {
            throw new Error('must not be called');
        },
    };
    const model = new MissingEpisodeApiModel(enabledConfig, seriesDB, makeProgramDB(null), reserveApi, {});
    await assert.rejects(() => model.reserveProposal(1, 1, 2, 999), /ProgramIsNotFound/);
});
