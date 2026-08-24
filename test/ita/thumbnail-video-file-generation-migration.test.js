'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { AddThumbnailVideoFileGeneration1787541900000 } = require('../../dist/db/migrations/sqlite/1787541900000-AddThumbnailVideoFileGeneration');

test('thumbnail世代管理migrationは3列を追加し既存行を保持して戻せる', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE thumbnail (id INTEGER PRIMARY KEY, recordedId INTEGER NOT NULL, filePath TEXT NOT NULL)');
    db.prepare('INSERT INTO thumbnail (id, recordedId, filePath) VALUES (1, 10, ?)').run('10-poster.jpg');
    const migration = new AddThumbnailVideoFileGeneration1787541900000();
    const runner = { query: async sql => db.exec(sql) };

    await migration.up(runner);
    assert.deepEqual(db.prepare('PRAGMA table_info(thumbnail)').all().map(column => column.name), ['id', 'recordedId', 'filePath', 'videoFileId', 'videoFileSize', 'videoFileAnalyzedAt']);
    assert.deepEqual(db.prepare('SELECT recordedId, filePath FROM thumbnail').get(), { recordedId: 10, filePath: '10-poster.jpg' });
    await migration.down(runner);
    assert.deepEqual(db.prepare('PRAGMA table_info(thumbnail)').all().map(column => column.name), ['id', 'recordedId', 'filePath']);
    db.close();
});
