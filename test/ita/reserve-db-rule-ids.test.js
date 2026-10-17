'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { DataSource } = require('typeorm');
const Reserve = require('../../dist/db/entities/Reserve').default;
const ReserveDB = require('../../dist/model/db/ReserveDB').default;

test('同じ局・番組名の予約から適格なルール ID だけを DISTINCT で取得する', async t => {
    const source = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [Reserve],
        synchronize: true,
    });
    await source.initialize();
    t.after(() => source.destroy());

    const logger = { getLogger: () => ({ system: { error() {} } }) };
    const reserveDB = new ReserveDB(
        { getConnection: async () => source },
        { run: callback => callback() },
        logger,
    );
    const repository = source.getRepository(Reserve);
    const insert = values => repository.save({
        updateTime: 1,
        channelId: 10,
        channel: '局A',
        channelType: 'GR',
        startAt: 100,
        endAt: 200,
        shortName: '同じ番組',
        programId: 1000,
        ...values,
    });

    await insert({ ruleId: 1 });
    await insert({ ruleId: 1, programId: 1001 });
    await insert({ ruleId: 2 });
    await insert({ ruleId: null });
    await insert({ ruleId: 3, programId: null });
    await insert({ ruleId: 4, isTimeSpecified: true });
    await insert({ ruleId: 5, isEventRelay: true });
    await insert({ ruleId: 6, channelId: 11 });
    await insert({ ruleId: 7, shortName: '別番組' });

    assert.deepEqual(await reserveDB.findRuleIdsByChannelAndShortName(10, '同じ番組'), [1, 2]);
});
