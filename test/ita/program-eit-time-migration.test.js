'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { AddProgramEitTime1787542000000 } = require('../../dist/db/migrations/sqlite/1787542000000-AddProgramEitTime');

test('program EIT時刻migrationは4列を追加し既存行を保持して戻せる', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE program (id INTEGER PRIMARY KEY, startAt INTEGER NOT NULL, endAt INTEGER NOT NULL)');
    db.prepare('INSERT INTO program (id, startAt, endAt) VALUES (1, 100, 200)').run();
    const migration = new AddProgramEitTime1787542000000();
    const runner = { query: async sql => db.exec(sql) };

    await migration.up(runner);
    assert.deepEqual(db.prepare('PRAGMA table_info(program)').all().map(column => column.name), [
        'id',
        'startAt',
        'endAt',
        'eitReceivedAt',
        'eitStartAt',
        'eitEndAt',
        'eitDurationUndefined',
    ]);
    assert.deepEqual(db.prepare('SELECT startAt, endAt, eitDurationUndefined FROM program').get(), {
        startAt: 100,
        endAt: 200,
        eitDurationUndefined: 0,
    });
    await migration.down(runner);
    assert.deepEqual(db.prepare('PRAGMA table_info(program)').all().map(column => column.name), ['id', 'startAt', 'endAt']);
    db.close();
});
