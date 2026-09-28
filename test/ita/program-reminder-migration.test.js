'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { AddProgramReminder1790572500000 } = require('../../dist/db/migrations/sqlite/1790572500000-AddProgramReminder');
const mysqlMigration = require('../../dist/db/migrations/mysql/1790572500000-AddProgramReminder');
const ProgramReminder = require('../../dist/db/entities/ProgramReminder').default;

test('program_reminder migration creates the table and index, applies defaults, and rolls back on sqlite', async () => {
    const up = [];
    const down = [];
    const migration = new AddProgramReminder1790572500000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });

    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
for sql in payload['up']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('program_reminder')")]
expected=['id','programId','channelId','name','startAt','minutesBefore','userId','createdAt']
assert cols == expected, cols
indexes=[row[1] for row in db.execute("PRAGMA index_list('program_reminder')")]
assert 'IDX_program_reminder_programId' in indexes, indexes
db.execute("INSERT INTO program_reminder (programId, channelId, name, startAt, createdAt) VALUES (327360102412345, 987654321012, '番組', 1000, 500)")
assert db.execute("SELECT programId, channelId FROM program_reminder").fetchone() == (327360102412345, 987654321012)
row=db.execute("SELECT minutesBefore, userId FROM program_reminder").fetchone()
assert row == (5, None), row
for sql in payload['down']: db.execute(sql)
assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='program_reminder'").fetchone()[0] == 0
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('mysql migration uses bigint for program and channel IDs', async () => {
    assert.equal(mysqlMigration.AddProgramReminder1790572500000.name, 'AddProgramReminder1790572500000');
    const sql = [];
    await new mysqlMigration.AddProgramReminder1790572500000().up({ query: async value => sql.push(value) });
    assert.match(sql[0], /`programId` bigint NOT NULL/);
    assert.match(sql[0], /`channelId` bigint NOT NULL/);
});

test('ProgramReminder entity declares program and channel IDs as bigint', () => {
    const columns = require('typeorm')
        .getMetadataArgsStorage()
        .columns.filter(column => column.target === ProgramReminder);
    for (const property of ['programId', 'channelId']) {
        assert.equal(columns.find(column => column.propertyName === property).options.type, 'bigint');
    }
});
