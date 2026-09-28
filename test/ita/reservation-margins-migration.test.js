'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
    AddReservationMargins1790572200000,
} = require('../../dist/db/migrations/sqlite/1790572200000-AddReservationMargins');
const mysql = require('../../dist/db/migrations/mysql/1790572200000-AddReservationMargins');

test('SQLite / MySQL migration は同じタイムスタンプを使う', () => {
    assert.equal(AddReservationMargins1790572200000.name, 'AddReservationMargins1790572200000');
    assert.equal(mysql.AddReservationMargins1790572200000.name, 'AddReservationMargins1790572200000');
});

test('予約マージン migration は3表へNULL列を追加し、既存行を保って戻せる', async () => {
    const db = new Database(':memory:');
    for (const table of ['reserve', 'rule', 'recorded']) db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
    db.exec('INSERT INTO reserve (id) VALUES (1)');
    const migration = new AddReservationMargins1790572200000();
    const runner = { query: async sql => db.exec(sql) };
    await migration.up(runner);
    assert.deepEqual(db.prepare('SELECT * FROM reserve').get(), { id: 1, startMarginSec: null, endMarginSec: null });
    await migration.down(runner);
    for (const table of ['reserve', 'rule', 'recorded']) {
        assert.deepEqual(
            db
                .prepare(`PRAGMA table_info(${table})`)
                .all()
                .map(column => column.name),
            ['id'],
        );
    }
    db.close();
});
