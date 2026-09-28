'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    AddRecordingSessions1787544000000,
} = require('../../dist/db/migrations/sqlite/1787544000000-AddRecordingSessions');

test('recording sessions migration survives up, down, up and leaves existing recorded values null', async () => {
    const migration = new AddRecordingSessions1787544000000();
    const up = [];
    const down = [];
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const input = JSON.stringify({ up, down });
    const python = String.raw`
import json, sqlite3, sys
p=json.load(sys.stdin); db=sqlite3.connect(':memory:'); db.execute('PRAGMA foreign_keys=ON')
db.execute('CREATE TABLE recorded (id integer PRIMARY KEY, name text NOT NULL)')
db.execute("INSERT INTO recorded (id,name) VALUES (1,'old')")
for sql in p['up']: db.execute(sql)
cols={row[1] for row in db.execute("PRAGMA table_info('recorded')")}
assert {'recordingStatus','endReason'} <= cols
assert db.execute('SELECT recordingStatus,endReason FROM recorded WHERE id=1').fetchone() == (None,None)
db.execute("INSERT INTO recording_session (reserveId,channelId,state,scheduledStartAt,scheduledEndAt,createdAt,updatedAt) VALUES (1,2,'RECORDING',10,20,10,10)")
db.execute("INSERT INTO recording_attempt (sessionId,attemptNo,requestedAt,priority) VALUES (1,1,10,0)")
db.execute('DELETE FROM recording_session WHERE id=1')
assert db.execute('SELECT count(*) FROM recording_attempt').fetchone()[0] == 0
for sql in p['down']: db.execute(sql)
assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'recording_%'").fetchone()[0] == 0
for sql in p['up']: db.execute(sql)
assert db.execute('SELECT recordingStatus,endReason FROM recorded WHERE id=1').fetchone() == (None,None)
`;
    const result = spawnSync('python3', ['-c', python], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
