'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const EPGUpdateManageModel = require('../../dist/model/epgUpdater/EPGUpdateManageModel').default;
const ChannelUtil = require('../../dist/util/ChannelUtil').default;

const createModel = () => {
    const calls = { warn: [], debug: [] };
    const logger = {
        getLogger: () => ({
            system: {
                info: () => {},
                debug: (...args) => calls.debug.push(args),
                warn: (...args) => calls.warn.push(args),
                error: () => {},
                fatal: () => {},
            },
        }),
    };
    const configuration = { getConfig: () => ({ mirakurunPath: 'http://localhost:40772' }) };
    const mirakurunClientModel = { getClient: () => ({}) };
    const channelDB = {};
    const programDB = {};

    return {
        model: new EPGUpdateManageModel(logger, configuration, mirakurunClientModel, channelDB, programDB),
        calls,
    };
};

const service = (overrides = {}) => ({
    id: 10,
    networkId: 1,
    serviceId: 101,
    name: 'テスト局',
    type: 1,
    hasLogoData: false,
    ...overrides,
});

test('ChannelUtil.resolvePhysicalChannel: Mirakurun API の配列形式を正規化する', () => {
    const raw = [
        { type: 'GR', channel: '27' },
        { type: 'BS', channel: '99' },
    ];

    assert.deepEqual(ChannelUtil.resolvePhysicalChannel(raw), { type: 'GR', channel: '27' });
    assert.deepEqual(ChannelUtil.resolvePhysicalChannel(raw[0]), { type: 'GR', channel: '27' });
});

test('updateChannelIndex: Service.channel が配列のとき先頭要素を使って索引を作る', () => {
    const { model, calls } = createModel();

    model.updateChannelIndex([
        service({
            channel: [
                { type: 'GR', channel: '27' },
                { type: 'BS', channel: '99' },
            ],
        }),
    ]);

    assert.deepEqual(model.channelIndex[1][101], { id: 10, type: 'GR', channel: '27' });
    assert.equal(model.channelNameIndex[10], 'テスト局');
    assert.equal(calls.warn.length, 0);
});

test('updateChannelIndex: Service.channel が単一オブジェクトでも Mirakurun 互換の値を使って索引を作る', () => {
    const { model, calls } = createModel();

    model.updateChannelIndex([
        service({
            id: 20,
            networkId: 2,
            serviceId: 201,
            name: 'テスト局2',
            channel: { type: 'BS', channel: '101' },
        }),
    ]);

    assert.deepEqual(model.channelIndex[2][201], { id: 20, type: 'BS', channel: '101' });
    assert.equal(model.channelNameIndex[20], 'テスト局2');
    assert.equal(calls.warn.length, 0);
});

test('updateChannelIndex: service.channel が未定義なら Mirakurun 仕様どおり skip される', () => {
    const { model, calls } = createModel();

    model.updateChannelIndex([
        service({
            id: 30,
            networkId: 3,
            serviceId: 301,
            name: '未定義局',
            channel: undefined,
        }),
    ]);

    assert.equal(typeof model.channelIndex[3], 'undefined');
    assert.equal(typeof model.channelNameIndex[30], 'undefined');
    assert.equal(calls.warn.length, 0);
    assert.equal(calls.debug.length, 0);
});

test('updateChannelIndex: channel.type が無い不正なオブジェクトは warn を 1 件だけ出す', () => {
    const { model, calls } = createModel();

    model.updateChannelIndex([
        service({
            id: 40,
            networkId: 4,
            serviceId: 401,
            name: '不正局',
            channel: [{ channel: '27' }],
        }),
    ]);

    assert.equal(typeof model.channelIndex[4], 'undefined');
    assert.equal(typeof model.channelNameIndex[40], 'undefined');
    assert.equal(calls.warn.length, 1);
    assert.equal(calls.debug.length, 0);
});
