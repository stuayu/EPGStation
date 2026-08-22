'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    AddSnsAccount1785111000000,
} = require('../../dist/db/migrations/sqlite/1785111000000-AddSnsAccount');
const {
    AddSnsAccountGrantedPermissions1785112000000,
} = require('../../dist/db/migrations/sqlite/1785112000000-AddSnsAccountGrantedPermissions');
const SnsAccountDB = require('../../dist/model/db/SnsAccountDB').default;

// --- 実 sqlite (python3) でのマイグレーション検証 -----------------------------------

test('sns_account sqlite migration creates the table + indexes and is reversible', async () => {
    const up = [];
    const down = [];
    const migration = new AddSnsAccount1785111000000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
for sql in payload['up']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('sns_account')")]
assert cols == ['id','provider','userId','remoteUserId','instanceUrl','handle','displayName','avatarUrl',
    'credential','defaultVisibility','defaultChannelId','defaultChannelName','isDefaultLocalOnly',
    'createdAt','updatedAt'], cols
indexes=[row[1] for row in db.execute("PRAGMA index_list('sns_account')")]
assert 'IDX_sns_account_unique' in indexes
assert 'IDX_sns_account_user' in indexes
for sql in payload['down']: db.execute(sql)
assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sns_account'").fetchone()[0] == 0
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

// MiAuth は permission がトークン発行時に固定されるため、連携時点の permission を記録して
// 再連携が必要かを判定できるようにするカラム。既存行への影響が無い (NULL 許容 + 既定値なし) ことを確認する
test('sns_account grantedPermissions sqlite migration adds a nullable column and is reversible', async () => {
    const up = [];
    const down = [];
    const base = new AddSnsAccount1785111000000();
    await base.up({ query: async sql => up.push(sql) });
    const migration = new AddSnsAccountGrantedPermissions1785112000000();
    const addUp = [];
    const addDown = [];
    await migration.up({ query: async sql => addUp.push(sql) });
    await migration.down({ query: async sql => addDown.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
for sql in payload['up']: db.execute(sql)
cols = "(provider,userId,remoteUserId,instanceUrl,handle,displayName,credential,isDefaultLocalOnly,createdAt,updatedAt)"
db.execute(f"insert into sns_account {cols} values ('misskey',1,'u1','misskey.io','h','d','c',0,0,0)")
for sql in payload['addUp']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('sns_account')")]
assert 'grantedPermissions' in cols, cols
# 既存行は NULL のまま (再連携判定側で「カラム追加前の行」として扱う)
row = db.execute("SELECT grantedPermissions FROM sns_account WHERE remoteUserId='u1'").fetchone()
assert row[0] is None, row
db.execute("UPDATE sns_account SET grantedPermissions=? WHERE remoteUserId='u1'", ('["write:notes"]',))
row = db.execute("SELECT grantedPermissions FROM sns_account WHERE remoteUserId='u1'").fetchone()
assert row[0] == '["write:notes"]', row
for sql in payload['addDown']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('sns_account')")]
assert 'grantedPermissions' not in cols, cols
`;
    const result = spawnSync('python3', ['-c', python], {
        input: JSON.stringify({ up, addUp, addDown }),
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
});

test('sns_account unique index rejects a true duplicate (provider, userId, remoteUserId, instanceUrl)', async () => {
    const up = [];
    const migration = new AddSnsAccount1785111000000();
    await migration.up({ query: async sql => up.push(sql) });
    const python = String.raw`
import sqlite3, json, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
for sql in payload['up']: db.execute(sql)
cols = "(provider,userId,remoteUserId,instanceUrl,handle,displayName,credential,isDefaultLocalOnly,createdAt,updatedAt)"
db.execute(f"insert into sns_account {cols} values ('bluesky',5,'did:abc','bsky.social','h','d','c',0,0,0)")
try:
    db.execute(f"insert into sns_account {cols} values ('bluesky',5,'did:abc','bsky.social','h2','d2','c2',0,1,1)")
    raise SystemExit(1)
except sqlite3.IntegrityError:
    pass
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

// --- SnsAccountDB の CRUD (インメモリ擬似コネクション) -----------------------------

class MemoryRepository {
    constructor() {
        this.rows = new Map();
        this.nextId = 1;
    }
    create(value) {
        return { ...value };
    }
    async save(value) {
        const id = value.id ?? this.nextId++;
        const saved = { ...value, id };
        this.rows.set(id, saved);
        return saved;
    }
    async delete(where) {
        this.rows.delete(where.id);
    }
    async findOne({ where }) {
        for (const row of this.rows.values()) {
            if (matches(row, where)) return row;
        }
        return null;
    }
    async find({ where, order }) {
        let result = [...this.rows.values()].filter(row => matches(row, where));
        if (order?.id === 'ASC') result = result.sort((a, b) => a.id - b.id);
        return result;
    }
}

// IsNull() が返す FindOperator ({ type: 'isNull' }) を含む where 句を評価する
function matches(row, where) {
    for (const [key, value] of Object.entries(where)) {
        if (value !== null && typeof value === 'object' && value.type === 'isNull') {
            if (row[key] !== null) return false;
        } else if (row[key] !== value) {
            return false;
        }
    }
    return true;
}

function makeConnection(repository) {
    return { getRepository: () => repository };
}

test('insertOnce() でレコードが作成され、findById() で取得できる', async () => {
    const repository = new MemoryRepository();
    const db = new SnsAccountDB({ getConnection: async () => makeConnection(repository) });
    const id = await db.insertOnce({
        provider: 'bluesky',
        userId: 1,
        remoteUserId: 'did:plc:abc',
        instanceUrl: 'bsky.social',
        handle: 'user.bsky.social',
        displayName: 'User',
        avatarUrl: null,
        credential: 'enc:v2:...',
        defaultVisibility: null,
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });
    const found = await db.findById(id);
    assert.notEqual(found, null);
    assert.equal(found.handle, 'user.bsky.social');
});

test('update() で既存行が更新される', async () => {
    const repository = new MemoryRepository();
    const db = new SnsAccountDB({ getConnection: async () => makeConnection(repository) });
    const id = await db.insertOnce({
        provider: 'misskey',
        userId: null,
        remoteUserId: 'abc123',
        instanceUrl: 'misskey.io',
        handle: 'user',
        displayName: 'User',
        avatarUrl: null,
        credential: 'enc:v2:...',
        defaultVisibility: 'public',
        defaultChannelId: null,
        defaultChannelName: null,
        isDefaultLocalOnly: false,
        createdAt: 1,
        updatedAt: 1,
    });
    const account = await db.findById(id);
    account.defaultVisibility = 'home';
    account.isDefaultLocalOnly = true;
    await db.update(account);
    const updated = await db.findById(id);
    assert.equal(updated.defaultVisibility, 'home');
    assert.equal(updated.isDefaultLocalOnly, true);
});

test('findByUser(null) は認証無効・匿名時の共有枠のアカウントだけを返す', async () => {
    const repository = new MemoryRepository();
    const db = new SnsAccountDB({ getConnection: async () => makeConnection(repository) });
    await db.insertOnce({
        provider: 'bluesky', userId: null, remoteUserId: 'did:shared', instanceUrl: 'bsky.social',
        handle: 'shared', displayName: 'Shared', avatarUrl: null, credential: 'c',
        defaultVisibility: null, defaultChannelId: null, defaultChannelName: null,
        isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1,
    });
    await db.insertOnce({
        provider: 'bluesky', userId: 42, remoteUserId: 'did:user42', instanceUrl: 'bsky.social',
        handle: 'user42', displayName: 'User42', avatarUrl: null, credential: 'c',
        defaultVisibility: null, defaultChannelId: null, defaultChannelName: null,
        isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1,
    });

    const shared = await db.findByUser(null);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].remoteUserId, 'did:shared');

    const user42 = await db.findByUser(42);
    assert.equal(user42.length, 1);
    assert.equal(user42[0].remoteUserId, 'did:user42');
});

test('findDuplicate() は provider + userId(null 含む) + remoteUserId + instanceUrl の完全一致だけを返す', async () => {
    const repository = new MemoryRepository();
    const db = new SnsAccountDB({ getConnection: async () => makeConnection(repository) });
    await db.insertOnce({
        provider: 'misskey', userId: null, remoteUserId: 'u1', instanceUrl: 'misskey.io',
        handle: 'u1', displayName: 'U1', avatarUrl: null, credential: 'c',
        defaultVisibility: 'public', defaultChannelId: null, defaultChannelName: null,
        isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1,
    });

    const found = await db.findDuplicate('misskey', null, 'u1', 'misskey.io');
    assert.notEqual(found, null);

    const notFoundDifferentInstance = await db.findDuplicate('misskey', null, 'u1', 'other.example');
    assert.equal(notFoundDifferentInstance, null);

    const notFoundDifferentUser = await db.findDuplicate('misskey', 1, 'u1', 'misskey.io');
    assert.equal(notFoundDifferentUser, null);
});

test('delete() で行が削除される', async () => {
    const repository = new MemoryRepository();
    const db = new SnsAccountDB({ getConnection: async () => makeConnection(repository) });
    const id = await db.insertOnce({
        provider: 'bluesky', userId: 1, remoteUserId: 'did:x', instanceUrl: 'bsky.social',
        handle: 'x', displayName: 'X', avatarUrl: null, credential: 'c',
        defaultVisibility: null, defaultChannelId: null, defaultChannelName: null,
        isDefaultLocalOnly: false, createdAt: 1, updatedAt: 1,
    });
    await db.delete(id);
    assert.equal(await db.findById(id), null);
});
