'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
    AddReservePlannedEndAt1787547000000,
} = require('../../dist/db/migrations/sqlite/1787547000000-AddReservePlannedEndAt');
const mysqlMigration = require('../../dist/db/migrations/mysql/1787547000000-AddReservePlannedEndAt');

test('SQLite / MySQL migration は同じタイムスタンプを使う', () => {
    assert.equal(AddReservePlannedEndAt1787547000000.name, 'AddReservePlannedEndAt1787547000000');
    assert.equal(mysqlMigration.AddReservePlannedEndAt1787547000000.name, 'AddReservePlannedEndAt1787547000000');
});

test('reserve plannedEndAt migrationは既存予約を保ってnull列を追加・削除する', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE reserve (id INTEGER PRIMARY KEY, endAt BIGINT NOT NULL)');
    db.prepare('INSERT INTO reserve (id, endAt) VALUES (1, 12345)').run();
    const migration = new AddReservePlannedEndAt1787547000000();
    const runner = { query: async sql => db.exec(sql) };

    await migration.up(runner);
    assert.deepEqual(db.prepare('SELECT endAt, plannedEndAt FROM reserve').get(), {
        endAt: 12345,
        plannedEndAt: null,
    });
    await migration.down(runner);
    assert.deepEqual(
        db
            .prepare('PRAGMA table_info(reserve)')
            .all()
            .map(column => column.name),
        ['id', 'endAt'],
    );
    db.close();
});
