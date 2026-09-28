'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
    AddReserveSchedulePlan1787545000000,
} = require('../../dist/db/migrations/sqlite/1787545000000-AddReserveSchedulePlan');

test('reserve schedule plan migration adds nullable fields, survives up/down/up', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE reserve (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO reserve (id, name) VALUES (1, ?)').run('既存予約');
    const migration = new AddReserveSchedulePlan1787545000000();
    const runner = { query: async sql => db.exec(sql) };

    await migration.up(runner);
    assert.deepEqual(
        db.prepare('PRAGMA table_info(reserve)').all().map(column => column.name),
        ['id', 'name', 'conflictInfo', 'plannedTunerIndex'],
    );
    assert.deepEqual(db.prepare('SELECT conflictInfo, plannedTunerIndex FROM reserve WHERE id = 1').get(), {
        conflictInfo: null,
        plannedTunerIndex: null,
    });

    const conflictInfo = JSON.stringify({ type: 'NO_TUNER', affectedMs: 1000, conflictingReserveIds: [2] });
    db.prepare('UPDATE reserve SET conflictInfo = ?, plannedTunerIndex = ? WHERE id = 1').run(conflictInfo, 3);
    assert.deepEqual(db.prepare('SELECT conflictInfo, plannedTunerIndex FROM reserve WHERE id = 1').get(), {
        conflictInfo,
        plannedTunerIndex: 3,
    });

    await migration.down(runner);
    assert.deepEqual(db.prepare('PRAGMA table_info(reserve)').all().map(column => column.name), ['id', 'name']);
    await migration.up(runner);
    assert.deepEqual(db.prepare('SELECT name, conflictInfo, plannedTunerIndex FROM reserve WHERE id = 1').get(), {
        name: '既存予約',
        conflictInfo: null,
        plannedTunerIndex: null,
    });
    db.close();
});
