'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createOnAirProgramSnapshot,
    findChangedOnAirChannels,
} = require('../../dist/model/epgUpdater/OnAirProgramSnapshot');
const EPGUpdateManageModel = require('../../dist/model/epgUpdater/EPGUpdateManageModel').default;
const ScheduleApiModel = require('../../dist/model/api/schedule/ScheduleApiModel').default;

const NOW = 1788087600000;
const MINUTE = 60 * 1000;

const program = (channelId, id, startAt, duration) => ({
    channelId,
    id,
    startAt,
    duration,
    endAt: startAt + duration,
});

test('未定番組は次番組の開始後に放送中の署名から外れ、次番組が先頭になる', () => {
    const programs = [
        program(3241621504, 1, NOW - 2 * 60 * MINUTE, 1),
        program(3241621504, 2, NOW - 62 * MINUTE, 5 * MINUTE),
        program(3241621504, 3, NOW - 12 * MINUTE, 45 * MINUTE),
    ];

    const snapshot = createOnAirProgramSnapshot(programs, NOW);
    assert.equal(snapshot.get(3241621504), `3:${NOW - 12 * MINUTE}:${NOW + 33 * MINUTE}`);
});

test('通常番組は終了時刻まで放送中の署名に残る', () => {
    const snapshot = createOnAirProgramSnapshot([program(1, 10, NOW - MINUTE, 2 * MINUTE)], NOW);
    assert.equal(snapshot.get(1), `10:${NOW - MINUTE}:${NOW + MINUTE}`);
});

test('放送中一覧は未定番組をクランプ後の終了時刻で除外する', async () => {
    const channel = {
        id: 3241621504,
        serviceId: 21504,
        networkId: 32416,
        name: 'ＮＨＫ総合１・福島',
        halfWidthName: 'NHK',
        remoteControlKeyId: null,
        hasLogoData: false,
        channelType: 'GR',
        channel: '16',
        type: 1,
    };
    const current = program(channel.id, 1, NOW - 2 * 60 * MINUTE, 1);
    current.endAt = NOW + 60 * MINUTE;
    const following = program(channel.id, 2, NOW - 12 * MINUTE, 45 * MINUTE);
    for (const item of [current, following]) {
        item.name = 'テスト番組';
        item.halfWidthName = 'テスト番組';
        item.isFree = true;
        item.description = null;
        item.extended = null;
        item.rawExtended = 'null';
        item.rawHalfWidthExtended = 'null';
    }
    const model = new ScheduleApiModel(
        { findAll: async () => [channel] },
        { findBroadcasting: async () => [current, following] },
        { getRegion: () => null },
        { updateCache: async () => {}, getAffiliation: () => null },
        { getConfig: () => ({ isHideDuplicateSubChannel: false }) },
    );

    const result = await model.getBroadcastingSchedule({
        isHalfWidth: true,
        includeNextProgram: true,
        time: NOW - new Date().getTime(),
    });
    assert.deepEqual(result[0].programs.map(p => p.id), [2]);
});

test('全件更新の前後比較は変化した放送局だけを返す', () => {
    const before = new Map([
        [1, '10:100:200'],
        [2, '20:100:200'],
    ]);
    const after = new Map([
        [1, '10:100:200'],
        [2, '21:200:300'],
        [3, '30:100:200'],
    ]);

    assert.deepEqual(findChangedOnAirChannels(before, after), [2, 3]);
});

test('全件更新は変化した放送局の放送中通知と範囲不明通知を出す', async () => {
    const logger = {
        getLogger: () => ({
            system: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
        }),
    };
    const service = {
        id: 3241621504,
        networkId: 32416,
        serviceId: 21504,
        name: 'ＮＨＫ総合１・福島',
        type: 1,
        channel: [{ type: 'GR', channel: '16' }],
    };
    const before = program(service.id, 1, NOW - MINUTE, 10 * MINUTE);
    const after = program(service.id, 2, NOW - MINUTE, 10 * MINUTE);
    let current = [before];
    const client = {
        getServices: async () => [service],
        getPrograms: async () => [after],
    };
    const channelDB = {
        insert: async () => {},
        deleteInvalidChannels: async () => 0,
    };
    const programDB = {
        findBroadcasting: async () => current,
        insert: async () => {
            current = [after];
        },
    };
    const configuration = { getConfig: () => ({ mirakurunPath: 'http://localhost:40772' }) };
    const model = new EPGUpdateManageModel(
        logger,
        configuration,
        { getClient: () => client },
        channelDB,
        programDB,
    );
    const onAir = [];
    const ranges = [];
    model.on('on air program updated', channelIds => onAir.push(channelIds));
    model.on('program range updated', notice => ranges.push(notice));

    const originalNow = Date.now;
    Date.now = () => NOW;
    try {
        await model.updateAll();
    } finally {
        Date.now = originalNow;
    }

    assert.deepEqual(onAir, [[service.id]]);
    assert.deepEqual(ranges, [{ programIds: [], channelIds: [], startAt: null, endAt: null }]);
});
