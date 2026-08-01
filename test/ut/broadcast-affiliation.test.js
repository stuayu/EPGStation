'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const BroadcastAffiliation = require('../../dist/model/channel/BroadcastAffiliation').default;
const BroadcastAffiliationCollector = require('../../dist/model/channel/BroadcastAffiliationCollector').default;

const createDBStub = items => {
    return {
        items: items ?? [],
        replaced: [],
        async findAll() {
            return this.items;
        },
        async replace(networkId, affiliationIds) {
            this.replaced.push({ networkId: networkId, affiliationIds: affiliationIds });

            return true;
        },
    };
};

const createLoggerStub = () => {
    return {
        getLogger: () => {
            return { system: { info: () => {}, warn: () => {}, error: () => {} } };
        },
    };
};

test('BIT を受信済みの放送局は系列に分類される', async () => {
    const db = createDBStub([{ networkId: 0x7fe0, affiliationId: 0x02, updatedAt: 1 }]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    const result = affiliation.getAffiliation({ networkId: 0x7fe0, channelType: 'GR' });
    assert.equal(result.id, 'ntv');
    assert.equal(result.order, 3);
});

test('BIT 未受信の放送局は未分類になる', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();

    const result = affiliation.getAffiliation({ networkId: 0x7fe0, channelType: 'GR' });
    assert.equal(result.id, 'unknown');
    assert.equal(result.order, 99);
});

test('BS / CS / SKY は系列別に分けない', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 4, channelType: 'BS' }), null);
    assert.equal(affiliation.getAffiliation({ networkId: 6, channelType: 'CS' }), null);
    assert.equal(affiliation.getAffiliation({ networkId: 1, channelType: 'SKY' }), null);
});

test('県外地上波 (NWxx) も系列別に分ける対象になる', async () => {
    const db = createDBStub([{ networkId: 0x7fe5, affiliationId: 0x04, updatedAt: 1 }]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 0x7fe5, channelType: 'NW3' }).id, 'cx');
});

test('クロスネット局は表示順が先の系列にまとめられる', async () => {
    const db = createDBStub([
        { networkId: 0x7fe1, affiliationId: 0x04, updatedAt: 1 }, // フジテレビ系 (order 7)
        { networkId: 0x7fe1, affiliationId: 0x05, updatedAt: 1 }, // テレビ朝日系 (order 4)
    ]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 0x7fe1, channelType: 'GR' }).id, 'ex');
});

test('未知の系列識別は「その他」として扱う', async () => {
    const db = createDBStub([{ networkId: 0x7fe2, affiliationId: 0x33, updatedAt: 1 }]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    const result = affiliation.getAffiliation({ networkId: 0x7fe2, channelType: 'GR' });
    assert.equal(result.id, 'other_51');
    assert.equal(result.order, 95);
});

test('系列一覧は表示順で返り、未分類が末尾になる', () => {
    const list = new BroadcastAffiliation(createDBStub([])).getAffiliations();

    assert.deepEqual(
        list.map(i => i.id),
        ['nhk_g', 'nhk_e', 'ntv', 'ex', 'tbs', 'tx', 'cx', 'independent', 'unknown'],
    );
});

test('BIT の broadcasters が示す original_network_id へ系列を割り当てる', async () => {
    const db = createDBStub([]);
    const collector = new BroadcastAffiliationCollector(db, createLoggerStub());

    await collector.collect([
        {
            originalNetworkId: 0x7fe0,
            broadcasters: [
                {
                    broadcasterId: 0x01,
                    terrestrialBroadcasterId: 0x0001,
                    affiliationIds: [0x02],
                    networkIds: [0x7fe0, 0x7fe4],
                },
            ],
        },
    ]);

    assert.deepEqual(db.replaced, [
        { networkId: 0x7fe0, affiliationIds: [0x02] },
        { networkId: 0x7fe4, affiliationIds: [0x02] },
    ]);
});

test('放送事業者が複数ある場合、対象の networkId が不明な事業者は保存しない', async () => {
    const db = createDBStub([]);
    const collector = new BroadcastAffiliationCollector(db, createLoggerStub());

    await collector.collect([
        {
            originalNetworkId: 0x7fe0,
            broadcasters: [
                { broadcasterId: 0x01, terrestrialBroadcasterId: 1, affiliationIds: [0x02], networkIds: [] },
                { broadcasterId: 0x02, terrestrialBroadcasterId: 2, affiliationIds: [0x03], networkIds: [0x7fe1] },
            ],
        },
    ]);

    assert.deepEqual(db.replaced, [{ networkId: 0x7fe1, affiliationIds: [0x03] }]);
});

test('放送事業者が 1 つだけならセクションの original_network_id へ割り当てる', async () => {
    const db = createDBStub([]);
    const collector = new BroadcastAffiliationCollector(db, createLoggerStub());

    await collector.collect([
        {
            originalNetworkId: 0x7fe9,
            broadcasters: [
                { broadcasterId: 0x01, terrestrialBroadcasterId: 1, affiliationIds: [0x07], networkIds: [] },
            ],
        },
    ]);

    assert.deepEqual(db.replaced, [{ networkId: 0x7fe9, affiliationIds: [0x07] }]);
});
