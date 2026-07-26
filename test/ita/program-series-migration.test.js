'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    AddProgramSeriesLink1785064000000,
} = require('../../dist/db/migrations/sqlite/1785064000000-AddProgramSeriesLink');
test('program-series sqlite migration is reversible', async () => {
    const up = [],
        down = [],
        m = new AddProgramSeriesLink1785064000000();
    await m.up({ query: async s => up.push(s) });
    await m.down({ query: async s => down.push(s) });
    const py = `import sqlite3,json,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for s in p['up']:d.execute(s)
assert d.execute("select count(*) from sqlite_master where name='program_series_link'").fetchone()[0]==1
for s in p['down']:d.execute(s)`;
    const x = spawnSync('python3', ['-c', py], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
});
