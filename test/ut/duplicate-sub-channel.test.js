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
    assert.deepEqual(
        result.map(s => s.channel.id),
        [sub1.id],
    );
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
