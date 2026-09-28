'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ReserveApiModel = require('../../dist/model/api/reserve/ReserveApiModel').default;

test('予約 API は planner の割当 index を返す', async () => {
    const reserve = {
        id: 7,
        isSkip: false,
        isConflict: false,
        conflictInfo: null,
        isOverlap: false,
        allowEndLack: false,
        startMarginSec: null,
        endMarginSec: null,
        priority: 3,
        conflictPolicy: 'lower_priority',
        isTimeSpecified: false,
        isTimeUndefined: false,
        isFollowingSchedule: false,
        isDeleteOriginalAfterEncode: false,
        plannedTunerIndex: 2,
        channelId: 1,
        startAt: 100,
        endAt: 200,
        name: '番組',
        ruleId: null,
        tags: null,
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
        encodeMode1: null,
        encodeParentDirectoryName1: null,
        encodeDirectory1: null,
        encodeMode2: null,
        encodeParentDirectoryName2: null,
        encodeDirectory2: null,
        encodeMode3: null,
        encodeParentDirectoryName3: null,
        encodeDirectory3: null,
        programId: null,
        description: null,
        extended: null,
        rawExtended: null,
        rawHalfWidthExtended: null,
        genre1: null,
        subGenre1: null,
        genre2: null,
        subGenre2: null,
        genre3: null,
        subGenre3: null,
        videoType: null,
        videoResolution: null,
        videoStreamContent: null,
        videoComponentType: null,
        audioSamplingRate: null,
    };
    const model = new ReserveApiModel({}, { findAll: async () => [[reserve], 1] });
    const result = await model.gets({ isHalfWidth: false });
    assert.equal(result.reserves[0].plannedTunerIndex, 2);
});
