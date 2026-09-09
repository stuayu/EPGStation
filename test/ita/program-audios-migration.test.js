'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { AddProgramAudios1787543000000 } = require('../../dist/db/migrations/sqlite/1787543000000-AddProgramAudios');

test('program audios migrationは列を追加し既存行を保持して戻せる', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE program (id INTEGER PRIMARY KEY, audioComponentType INTEGER)');
    db.prepare('INSERT INTO program (id, audioComponentType) VALUES (1, 3)').run();
    const migration = new AddProgramAudios1787543000000();
    const runner = { query: async sql => db.exec(sql) };

    await migration.up(runner);
    assert.deepEqual(
        db
            .prepare('PRAGMA table_info(program)')
            .all()
            .map(column => column.name),
        ['id', 'audioComponentType', 'audios'],
    );
    // 既存行は audios が未設定 (null) のまま残る
    assert.deepEqual(db.prepare('SELECT audioComponentType, audios FROM program').get(), {
        audioComponentType: 3,
        audios: null,
    });

    // 追加した列に音声 ES 一覧を保存できる
    const audios = JSON.stringify([{ componentType: 2, componentTag: 16, isMain: true, langs: ['jpn', 'eng'] }]);
    db.prepare('UPDATE program SET audios = ? WHERE id = 1').run(audios);
    assert.equal(db.prepare('SELECT audios FROM program WHERE id = 1').get().audios, audios);

    await migration.down(runner);
    assert.deepEqual(
        db
            .prepare('PRAGMA table_info(program)')
            .all()
            .map(column => column.name),
        ['id', 'audioComponentType'],
    );
    db.close();
});
