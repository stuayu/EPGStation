'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    AddVideoFileTsInfo1785105000000,
} = require('../../dist/db/migrations/sqlite/1785105000000-AddVideoFileTsInfo');

test('sqlite migration creates video_file_ts_info and rolls back on a real sqlite engine', async () => {
    const up = [];
    const down = [];
    const migration = new AddVideoFileTsInfo1785105000000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });

    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
# 外部キー参照先を先に用意する
db.execute("CREATE TABLE video_file (id integer PRIMARY KEY NOT NULL, type text)")
for sql in payload['up']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('video_file_ts_info')")]
expected=['videoFileId','networkId','transportStreamId','serviceId','serviceType','serviceName',
          'serviceProviderName','networkName','eventId','eventName','eventDescription','eventExtended',
          'eventStartAt','eventDuration','genre1','subGenre1','genre2','subGenre2','genre3','subGenre3',
          'videoStreamType','videoPid','audioStreamType','audioPid','firstTdtAt','analyzedAt']
assert cols == expected, cols
indexes=[row[1] for row in db.execute("PRAGMA index_list('video_file_ts_info')")]
assert 'IDX_video_file_ts_info_service' in indexes, indexes
# 実際に 1 件入れて読み出せること
db.execute("INSERT INTO video_file (id, type) VALUES (1, 'ts')")
db.execute("INSERT INTO video_file_ts_info (videoFileId, networkId, serviceId, serviceName, analyzedAt) VALUES (1, 32416, 21504, 'テスト局', 100)")
row=db.execute("SELECT networkId, serviceId, serviceName FROM video_file_ts_info WHERE videoFileId = 1").fetchone()
assert row == (32416, 21504, 'テスト局'), row
for sql in payload['down']: db.execute(sql)
assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='video_file_ts_info'").fetchone()[0] == 0
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
