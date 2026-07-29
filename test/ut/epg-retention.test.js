'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const EPGUpdateManageModel = require('../../dist/model/epgUpdater/EPGUpdateManageModel').default;

const createModel = (config = {}) => {
    const calls = { deleteOld: [], insert: [] };
    const logger = {
        getLogger: () => ({
            system: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
        }),
    };
    const configuration = { getConfig: () => Object.assign({ mirakurunPath: 'http://localhost:40772' }, config) };
    const mirakurunClientModel = { getClient: () => ({}) };
    const channelDB = {};
    const programDB = {
        deleteOld: async time => {
            calls.deleteOld.push(time);
        },
        insert: async (channelTypes, programs, deleteChannelIds, keepOption) => {
            calls.insert.push(keepOption);
        },
    };

    return {
        model: new EPGUpdateManageModel(logger, configuration, mirakurunClientModel, channelDB, programDB),
        calls,
    };
};

test('epgRetentionTime 未指定なら現在時刻より前に終了した番組を削除する (従来動作)', async () => {
    const { model, calls } = createModel();
    const before = Date.now();
    await model.deleteOldPrograms();

    assert.equal(calls.deleteOld.length, 1);
    assert.equal(calls.deleteOld[0] >= before, true);
    assert.equal(calls.deleteOld[0] <= Date.now(), true);
});

test('epgRetentionTime を指定するとその時間だけ過去の番組を残す', async () => {
    const { model, calls } = createModel({ epgRetentionTime: 24 });
    const before = Date.now();
    await model.deleteOldPrograms();

    assert.equal(calls.deleteOld.length, 1);
    // しきい値は「現在時刻 - 24 時間」
    const expected = before - 24 * 60 * 60 * 1000;
    assert.equal(Math.abs(calls.deleteOld[0] - expected) < 5000, true);
});

test('epgRetentionTime が負数なら無期限保存として削除しない', async () => {
    const { model, calls } = createModel({ epgRetentionTime: -1 });
    await model.deleteOldPrograms();

    assert.equal(calls.deleteOld.length, 0);
});

test('全件更新時の削除条件も保存期間に従う', async () => {
    const cases = [
        { config: {}, expectThreshold: 0 },
        { config: { epgRetentionTime: 24 }, expectThreshold: 24 * 60 * 60 * 1000 },
        { config: { epgRetentionTime: -1 }, expectThreshold: null },
    ];

    for (const c of cases) {
        const { model } = createModel(c.config);
        const option = model.createProgramKeepOption();

        if (c.expectThreshold === null) {
            assert.equal(option.retentionThreshold, null);
        } else {
            assert.equal(Math.abs(option.now - option.retentionThreshold - c.expectThreshold) < 5000, true);
        }
    }
});
