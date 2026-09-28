'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
    AddReservationPriorityPolicy1787546000000,
} = require('../../dist/db/migrations/sqlite/1787546000000-AddReservationPriorityPolicy');

test('reservation priority migration maps legacy flags and survives up/down/up', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE reserve (id INTEGER PRIMARY KEY, allowEndLack BOOLEAN NOT NULL DEFAULT 0)');
    db.exec('CREATE TABLE rule (id INTEGER PRIMARY KEY, allowEndLack BOOLEAN NOT NULL DEFAULT 1)');
    db.exec('INSERT INTO reserve VALUES (1, 1), (2, 0)');
    db.exec('INSERT INTO rule VALUES (1, 1), (2, 0)');
    const migration = new AddReservationPriorityPolicy1787546000000();
    const runner = { query: async sql => db.exec(sql) };

    await migration.up(runner);
    assert.deepEqual(db.prepare('SELECT priority, conflictPolicy FROM reserve ORDER BY id').all(), [
        { priority: 3, conflictPolicy: 'ALLOW_END_LACK' },
        { priority: 3, conflictPolicy: 'STRICT' },
    ]);
    assert.deepEqual(db.prepare('SELECT priority, conflictPolicy FROM rule ORDER BY id').all(), [
        { priority: 3, conflictPolicy: 'ALLOW_END_LACK' },
        { priority: 3, conflictPolicy: 'STRICT' },
    ]);
    await migration.down(runner);
    await migration.up(runner);
    assert.equal(db.prepare('SELECT count(*) AS count FROM reserve').get().count, 2);
    assert.equal(db.prepare('SELECT count(*) AS count FROM rule').get().count, 2);
    db.close();
});
