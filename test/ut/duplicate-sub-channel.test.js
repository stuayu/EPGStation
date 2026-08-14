'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const ScheduleApiModel = require('../../dist/model/api/schedule/ScheduleApiModel').default;
const EPGUpdateManageModel = require('../../dist/model/epgUpdater/EPGUpdateManageModel').default;

const NOW = 1786629600000;
const HALF_HOUR = 30 * 60 * 1000;

const channel = (serviceId, name) => ({
    id: 32311 * 100000 + serviceId,
    serviceId: serviceId,
    networkId: 32311,
    name: name,
    halfWidthName: name,
    remoteControlKeyId: null,
    hasLogoData: false,
    channelTypeId: 0,
    channelType: 'GR',
    channel: '0',
    type: 1,
});

const program = (ch, startAt, name) => ({
    id: ch.id * 100000 + startAt,
    channelId: ch.id,
    startAt: startAt,
    endAt: startAt + HALF_HOUR,
    duration: HALF_HOUR,
    isFree: true,
    name: name,
    halfWidthName: name,
    description: null,
    halfWidthDescription: null,
    extended: null,
    halfWidthExtended: null,
    rawExtended: null,
    rawHalfWidthExtended: null,
});

const createModel = (channels, programs, isHideDuplicateSubChannel) => {
    const channelDB = { findAll: async () => channels };
    const programDB = { findBroadcasting: async () => programs };
    const broadcastRegion = { getRegion: () => null };
    const broadcastAffiliation = { updateCache: async () => {}, getAffiliation: () => null };
    const configuration = { getConfig: () => ({ isHideDuplicateSubChannel: isHideDuplicateSubChannel }) };

    return new ScheduleApiModel(channelDB, programDB, broadcastRegion, broadcastAffiliation, configuration);
};

const parent = channel(28728, 'とちぎテレビ１');
const sub1 = channel(28729, 'とちぎテレビ２');
const sub2 = channel(28730, 'とちぎテレビ３');

test('親と同じ番組しか持たないサブチャンネルは放映中の一覧から除外される', async () => {
    const model = createModel(
        [parent, sub1, sub2],
        [program(parent, NOW, '無自覚聖女'), program(sub1, NOW, '無自覚聖女'), program(sub2, NOW, '無自覚聖女')],
        true,
    );

    const result = await model.getBroadcastingSchedule({ isHalfWidth: true });
    assert.deepEqual(
        result.map(s => s.channel.id),
        [parent.id],
    );
});

test('親と異なる番組を放送しているサブチャンネルは残る', async () => {
    const model = createModel(
        [parent, sub1, sub2],
        [program(parent, NOW, '無自覚聖女'), program(sub1, NOW, '無自覚聖女'), program(sub2, NOW, '高校野球中継')],
        true,
    );

    const result = await model.getBroadcastingSchedule({ isHalfWidth: true });
    assert.deepEqual(
        result.map(s => s.channel.id),
        [parent.id, sub2.id],
    );
});

test('isHideDuplicateSubChannel が false ならサブチャンネルを除外しない', async () => {
    const model = createModel(
        [parent, sub1, sub2],
        [program(parent, NOW, '無自覚聖女'), program(sub1, NOW, '無自覚聖女'), program(sub2, NOW, '無自覚聖女')],
        false,
    );

    const result = await model.getBroadcastingSchedule({ isHalfWidth: true });
    assert.deepEqual(
        result.map(s => s.channel.id),
        [parent.id, sub1.id, sub2.id],
    );
});

test('親チャンネルの番組が取得できていないときはサブチャンネルを除外しない', async () => {
    const model = createModel([parent, sub1], [program(sub1, NOW, '無自覚聖女')], true);

    const result = await model.getBroadcastingSchedule({ isHalfWidth: true });
    // 親は EPG が無くても放映中には出す (番組一覧は空)
    assert.deepEqual(
        result.map(s => s.channel.id),
        [parent.id, sub1.id],
    );
    assert.deepEqual(result[0].programs, []);
});

test('EPG が取得できていない放送局も放映中には親サービスだけ出る', async () => {
    const model = createModel([parent, sub1, sub2], [], true);

    const result = await model.getBroadcastingSchedule({ isHalfWidth: true });
    assert.deepEqual(
        result.map(s => s.channel.id),
        [parent.id],
    );
    assert.deepEqual(result[0].programs, []);
});

test('映像・音声サービス以外は番組が無ければ放映中に出さない', async () => {
    // データ放送 (type: 192) だけの放送局。親サービス扱いにしない
    const dataService = { ...channel(28800, 'とちぎテレビデータ'), networkId: 32399, id: 3239928800, type: 192 };
    const model = createModel([dataService], [], true);

    assert.deepEqual(await model.getBroadcastingSchedule({ isHalfWidth: true }), []);
});

test('番組表は EPG が取得できていない放送局を出さない', async () => {
    const model = createModel([parent, sub1], [], true);
    // 番組表側は findChannleTypes / findSchedule を使う
    model.channelDB.findChannleTypes = async () => [parent, sub1];
    model.programDB.findSchedule = async () => [];

    const result = await model.getSchedules({
        GR: true,
        startAt: NOW,
        endAt: NOW + HALF_HOUR,
        isHalfWidth: true,
    });
    assert.deepEqual(result, []);
});

const createUpdateManageModel = insertedServices => {
    const logger = {
        getLogger: () => ({
            system: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
        }),
    };
    const configuration = { getConfig: () => ({ mirakurunPath: 'http://localhost:40772' }) };
    const services = [
        { id: 3231128728, networkId: 32311, serviceId: 28728, name: 'とちぎテレビ１', type: 1, channel: [{ type: 'GR', channel: '28' }] },
        { id: 3230400000, networkId: 32304, serviceId: 0, name: '46Ch(NHKG宇都宮)', type: 0, channel: [{ type: 'GR', channel: '33' }] },
        { id: 3233600001, networkId: 32336, serviceId: 1, name: '無効サービス', type: 0, channel: [{ type: 'GR', channel: '39' }] },
    ];
    const mirakurunClientModel = { getClient: () => ({ getServices: async () => services }) };
    const channelDB = {
        insert: async values => {
            insertedServices.push(...values);
        },
        deleteInvalidChannels: async () => 0,
    };

    return new EPGUpdateManageModel(logger, configuration, mirakurunClientModel, channelDB, {});
};

test('serviceId 0 と service_type 0 の無効サービスは放送局として取り込まない', async () => {
    const inserted = [];
    const model = createUpdateManageModel(inserted);

    await model.updateChannels();

    assert.deepEqual(
        inserted.map(s => s.serviceId),
        [28728],
    );
});
