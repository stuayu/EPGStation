'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { AddRecordingPreset1790572400000 } = require('../../dist/db/migrations/sqlite/1790572400000-AddRecordingPreset');

test('録画プリセット migration はテーブルを作成し up/down できる', async () => {
    const up = [];
    const down = [];
    const migration = new AddRecordingPreset1790572400000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
p=json.load(sys.stdin); db=sqlite3.connect(':memory:')
for sql in p['up']: db.execute(sql)
cols=[r[1] for r in db.execute("PRAGMA table_info('recording_preset')")]
assert cols == ['id','name','isDefault','settings','createdAt','updatedAt'], cols
db.execute("insert into recording_preset (name,isDefault,settings,createdAt,updatedAt) values ('default',1,'{}',1,1)")
assert db.execute('select count(*) from recording_preset').fetchone()[0] == 1
for sql in p['down']: db.execute(sql)
assert db.execute("select count(*) from sqlite_master where type='table' and name='recording_preset'").fetchone()[0] == 0
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
