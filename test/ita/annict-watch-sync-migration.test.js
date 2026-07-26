'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    AddAnnictWatchSync1785080000000,
} = require('../../dist/db/migrations/sqlite/1785080000000-AddAnnictWatchSync');
const {
    AddSeriesReservationHint1785081000000,
} = require('../../dist/db/migrations/sqlite/1785081000000-AddSeriesReservationHint');

async function checkReversible(MigrationClass, tableName) {
    const up = [],
        down = [],
        m = new MigrationClass();
    await m.up({ query: async s => up.push(s) });
    await m.down({ query: async s => down.push(s) });
    const py = `import sqlite3,json,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for s in p['up']:d.execute(s)
assert d.execute("select count(*) from sqlite_master where name='${tableName}'").fetchone()[0]==1
for s in p['down']:d.execute(s)
assert d.execute("select count(*) from sqlite_master where name='${tableName}'").fetchone()[0]==0`;
    const x = spawnSync('python3', ['-c', py], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
}

test('annict_watch_sync sqlite migration creates a unique (seriesId, seriesEpisodeId) index and is reversible', async () => {
    await checkReversible(AddAnnictWatchSync1785080000000, 'annict_watch_sync');
});

test('annict_watch_sync unique index actually rejects duplicate (seriesId, seriesEpisodeId) rows', async () => {
    const up = [],
        m = new AddAnnictWatchSync1785080000000();
    await m.up({ query: async s => up.push(s) });
    const py = `import sqlite3,json,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for s in p['up']:d.execute(s)
d.execute("insert into annict_watch_sync (recordedId,seriesId,seriesEpisodeId,annictWorkId,episodeNumber,nextAttemptAt,createdAt,updatedAt) values (1,1,1,'a',1,0,0,0)")
try:
    d.execute("insert into annict_watch_sync (recordedId,seriesId,seriesEpisodeId,annictWorkId,episodeNumber,nextAttemptAt,createdAt,updatedAt) values (2,1,1,'a',1,0,0,0)")
    raise SystemExit(1)
except sqlite3.IntegrityError:
    pass`;
    const x = spawnSync('python3', ['-c', py], { input: JSON.stringify({ up }), encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
});

test('series_reservation_hint sqlite migration is reversible', async () => {
    await checkReversible(AddSeriesReservationHint1785081000000, 'series_reservation_hint');
});
