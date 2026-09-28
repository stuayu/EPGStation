'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    AddRecordingResultMetadata1790572100000,
} = require('../../dist/db/migrations/sqlite/1790572100000-AddRecordingResultMetadata');

test('録画結果メタデータ migration は up/down/up でき、既存行を保持する', async () => {
    const migration = new AddRecordingResultMetadata1790572100000();
    const up = [];
    const down = [];
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
p=json.load(sys.stdin); db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE recording_session (id integer PRIMARY KEY, reserveId integer NOT NULL)')
db.execute('INSERT INTO recording_session VALUES (1, 8)')
for sql in p['up']: db.execute(sql)
cols={r[1] for r in db.execute("PRAGMA table_info('recording_session')")}
assert {'name','ruleId','channelName','isTimeSpecified'} <= cols
assert db.execute('SELECT name,ruleId,channelName,isTimeSpecified FROM recording_session WHERE id=1').fetchone() == (None,None,None,0)
db.execute("INSERT INTO recording_session (id,reserveId,name,ruleId,channelName,isTimeSpecified) VALUES (2,9,'新番組',12,'局A',1)")
for sql in p['down']: db.execute(sql)
cols={r[1] for r in db.execute("PRAGMA table_info('recording_session')")}
assert not {'name','ruleId','channelName','isTimeSpecified'} & cols
for sql in p['up']: db.execute(sql)
assert db.execute('SELECT count(*) FROM recording_session').fetchone()[0] == 2
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
