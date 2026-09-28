'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { AddFinishCommandName1790572600000 } = require('../../dist/db/migrations/sqlite/1790572600000-AddFinishCommandName');

test('録画終了コマンド名 migration は既存行を保ち up/down できる', async () => {
    const up = [];
    const down = [];
    const migration = new AddFinishCommandName1790572600000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
p=json.load(sys.stdin); db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE "rule" ("id" integer primary key)')
db.execute('CREATE TABLE "reserve" ("id" integer primary key)')
db.execute('INSERT INTO "rule" VALUES (1)'); db.execute('INSERT INTO "reserve" VALUES (2)')
for sql in p['up']: db.execute(sql)
assert [r[1] for r in db.execute('PRAGMA table_info("rule")')][-1] == 'finishCommandName'
assert [r[1] for r in db.execute('PRAGMA table_info("reserve")')][-1] == 'finishCommandName'
assert db.execute('SELECT id, finishCommandName FROM "rule"').fetchone() == (1, None)
assert db.execute('SELECT id, finishCommandName FROM "reserve"').fetchone() == (2, None)
for sql in p['down']: db.execute(sql)
assert [r[1] for r in db.execute('PRAGMA table_info("rule")')] == ['id']
assert [r[1] for r in db.execute('PRAGMA table_info("reserve")')] == ['id']
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
