'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { AddUser1785102000000 } = require('../../dist/db/migrations/sqlite/1785102000000-AddUser');

/**
 * 実 sqlite に対して up / down を流し、ログインユーザー表が作られて元に戻せることを確認する
 */
function runSqlite(script, payload) {
    const x = spawnSync('python3', ['-c', script], { input: JSON.stringify(payload), encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
    return x.stdout;
}

async function collect() {
    const up = [];
    const down = [];
    const migration = new AddUser1785102000000();
    await migration.up({ query: async s => up.push(s) });
    await migration.down({ query: async s => down.push(s) });
    return { up, down };
}

test('user sqlite migration creates the table and is reversible', async () => {
    const script = `import sqlite3,json,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for s in p['up']:d.execute(s)
assert d.execute("select count(*) from sqlite_master where name='user'").fetchone()[0]==1
for s in p['down']:d.execute(s)
assert d.execute("select count(*) from sqlite_master where name='user'").fetchone()[0]==0`;
    runSqlite(script, await collect());
});

test('user names are unique and tokenVersion defaults to 1', async () => {
    const { up } = await collect();
    const script = `import sqlite3,json,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for s in p['up']:d.execute(s)
d.execute("insert into user (name, passwordHash, createdAt, updatedAt) values ('admin','h',1,1)")
# tokenVersion は既定 1 (セッション失効の基準になるため NULL にしない)
assert d.execute("select tokenVersion from user where name='admin'").fetchone()[0]==1
try:
    d.execute("insert into user (name, passwordHash, createdAt, updatedAt) values ('admin','h2',2,2)")
    raise AssertionError('duplicate user name was accepted')
except sqlite3.IntegrityError:
    pass`;
    runSqlite(script, { up });
});

test('role and identity migration defaults existing users to admin and keeps identities unique', async () => {
    const { AddUserRoleAndIdentity1785103000000 } = require('../../dist/db/migrations/sqlite/1785103000000-AddUserRoleAndIdentity');
    const base = await collect();
    const up = [];
    const down = [];
    const migration = new AddUserRoleAndIdentity1785103000000();
    await migration.up({ query: async s => up.push(s) });
    await migration.down({ query: async s => down.push(s) });

    const script = `import sqlite3,json,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for s in p['base']:d.execute(s)
d.execute("insert into user (name, passwordHash, createdAt, updatedAt) values ('admin','h',1,1)")
for s in p['up']:d.execute(s)
# 既存ユーザー (認証追加時に作った最初の管理者) は admin に引き上げる
assert d.execute("select role from user where name='admin'").fetchone()[0]=='admin'
d.execute("insert into user_identity (userId, provider, providerUserId, createdAt, updatedAt) values (1,'google','x',1,1)")
try:
    d.execute("insert into user_identity (userId, provider, providerUserId, createdAt, updatedAt) values (1,'google','x',2,2)")
    raise AssertionError('duplicate identity was accepted')
except sqlite3.IntegrityError:
    pass
for s in p['down']:d.execute(s)
assert d.execute("select count(*) from sqlite_master where name='user_identity'").fetchone()[0]==0`;
    runSqlite(script, { base: base.up, up, down });
});
