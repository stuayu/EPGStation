'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { AddSavedSearch1785066000000 } = require('../../dist/db/migrations/sqlite/1785066000000-AddSavedSearch');
const {
    AddRecordedTagParent1785065000000,
} = require('../../dist/db/migrations/sqlite/1785065000000-AddRecordedTagParent');

test('saved_search sqlite migration applies and rolls back on a real sqlite engine', async () => {
    const up = [];
    const down = [];
    const migration = new AddSavedSearch1785066000000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
for sql in payload['up']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('saved_search')")]
assert cols == ['id','name','query','isPinned','createdAt','updatedAt'], cols
db.execute("insert into saved_search (name, query, isPinned, createdAt, updatedAt) values ('a','{}',0,1,1)")
assert db.execute("select count(*) from saved_search").fetchone()[0] == 1
for sql in payload['down']: db.execute(sql)
assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='saved_search'").fetchone()[0] == 0
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('recorded_tag parentId sqlite migration adds a nullable indexed column and rolls back', async () => {
    const up = [];
    const down = [];
    const migration = new AddRecordedTagParent1785065000000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.execute("CREATE TABLE recorded_tag (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, name text NOT NULL, halfWidthName text NOT NULL, color text NOT NULL)")
for sql in payload['up']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('recorded_tag')")]
assert 'parentId' in cols
indexes=[row[1] for row in db.execute("PRAGMA index_list('recorded_tag')")]
assert 'IDX_recorded_tag_parentId' in indexes
db.execute("insert into recorded_tag (name, halfWidthName, color) values ('a','a','#fff')")
assert db.execute("select parentId from recorded_tag").fetchone()[0] is None
for sql in payload['down']: db.execute(sql)
cols_after=[row[1] for row in db.execute("PRAGMA table_info('recorded_tag')")]
assert 'parentId' not in cols_after
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
