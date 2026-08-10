'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    AddRule4KBroadcastWave1785110000000,
} = require('../../dist/db/migrations/sqlite/1785110000000-AddRule4KBroadcastWave');

test('rule BS4K/CS4K sqlite migration adds the columns with a false default and rolls back', async () => {
    const up = [];
    const down = [];
    const migration = new AddRule4KBroadcastWave1785110000000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.execute("CREATE TABLE rule (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, GR boolean NOT NULL DEFAULT (0), BS boolean NOT NULL DEFAULT (0), CS boolean NOT NULL DEFAULT (0), SKY boolean NOT NULL DEFAULT (0))")
db.execute("insert into rule (GR) values (1)")
for sql in payload['up']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('rule')")]
assert 'BS4K' in cols and 'CS4K' in cols, cols
# 既存行は 4K が無効のまま (既存ルールの挙動を変えない)
assert db.execute("select BS4K, CS4K from rule").fetchone() == (0, 0)
db.execute("update rule set BS4K = 1")
assert db.execute("select BS4K from rule").fetchone()[0] == 1
for sql in payload['down']: db.execute(sql)
cols_after=[row[1] for row in db.execute("PRAGMA table_info('rule')")]
assert 'BS4K' not in cols_after and 'CS4K' not in cols_after, cols_after
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
