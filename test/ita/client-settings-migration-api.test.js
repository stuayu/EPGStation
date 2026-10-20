'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { test } = require('node:test');
const ClientSetting = require('../../dist/db/entities/ClientSetting').default;
const { AddClientSetting1792490000000 } = require('../../dist/db/migrations/sqlite/1792490000000-AddClientSetting');
const ClientSettingsApiModel = require('../../dist/model/api/clientSettings/ClientSettingsApiModel').default;

test('client settings migration and API model use sqlite, isolate users, and detect stale updates', async () => {
    const dataSource = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [ClientSetting],
        synchronize: false,
    });
    await dataSource.initialize();
    const migration = new AddClientSetting1792490000000();
    await migration.up(dataSource.createQueryRunner());

    try {
        const model = new ClientSettingsApiModel({ getConnection: async () => dataSource });
        assert.deepEqual(await model.get(null), { settings: {}, updatedAt: 0 });

        const userColumn = (await dataSource.query('PRAGMA table_info("client_setting")')).find(
            column => column.name === 'userId',
        );
        assert.equal(userColumn.notnull, 1);

        const shared = await model.put(null, { shared: true }, 0);
        assert.equal((await dataSource.query('SELECT "userId" FROM "client_setting" WHERE "userId" = 0')).length, 1);
        assert.deepEqual((await model.get(null)).settings, { shared: true });
        const sharedUpdated = await model.put(null, { shared: false }, shared.updatedAt);
        assert.deepEqual((await model.get(null)).settings, { shared: false });

        const concurrent = await Promise.allSettled([
            model.put(null, { shared: 'concurrent-a' }, sharedUpdated.updatedAt),
            model.put(null, { shared: 'concurrent-b' }, sharedUpdated.updatedAt),
        ]);
        assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal((await dataSource.query('SELECT "id" FROM "client_setting" WHERE "userId" = 0')).length, 1);

        const first = await model.put(1, { muted: true }, 0);
        assert.deepEqual(first.settings, { muted: true });
        assert.ok(first.updatedAt > 0);
        await assert.rejects(model.put(1, { muted: false }, 0), error => error.message === 'ClientSettingsConflict');
        assert.deepEqual((await model.get(1)).settings, { muted: true });
        assert.deepEqual(await model.get(2), { settings: {}, updatedAt: 0 });

        const updated = await model.put(1, { muted: false }, first.updatedAt);
        assert.deepEqual(updated.settings, { muted: false });

        await migration.down(dataSource.createQueryRunner());
        assert.deepEqual(
            await dataSource.query("SELECT name FROM sqlite_master WHERE type='table' AND name='client_setting'"),
            [],
        );
    } finally {
        await dataSource.destroy();
    }
});
