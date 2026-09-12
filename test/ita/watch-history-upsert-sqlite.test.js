'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DataSource } = require('typeorm');
const WatchHistory = require('../../dist/db/entities/WatchHistory').default;
const WatchHistoryDB = require('../../dist/model/db/WatchHistoryDB').default;

const createDataSource = database =>
    new DataSource({
        type: 'better-sqlite3',
        database,
        entities: [WatchHistory],
        synchronize: true,
    });

// 実際の TypeORM + better-sqlite3 で、既存行に対して WatchHistoryDB.upsert() を呼ぶ回帰テスト。
// insert().orUpdate() は既定の updateEntity(true) だと、ON CONFLICT で既存行の更新になったときに
// 挿入 id が無いため "Cannot update entity because entity id is not set in the entity." で失敗し、
// 再生位置の PUT が毎回 500 になっていた。
// **既存行を入れた接続とは別の接続で upsert する**。同じ接続で直前に INSERT していると、SQLite の
// last_insert_rowid() がその id を返し続けるため失敗が隠れる (擬似コネクションや :memory: では検出できなかった)
test('watch-history upsert updates an existing row on a real sqlite engine', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-watch-history-'));
    const database = path.join(dir, 'database.db');
    try {
        const seed = createDataSource(database);
        await seed.initialize();
        await seed.query(
            `INSERT INTO "watch_history" ("videoFileId", "recordedId", "userId", "position", "duration", "status", "updatedAt") VALUES (10, 20, NULL, 30, 100, 'watching', 1)`,
        );
        await seed.destroy();

        const ds = createDataSource(database);
        await ds.initialize();
        try {
            const db = new WatchHistoryDB({ getConnection: async () => ds });
            const updated = await db.upsert({
                videoFileId: 10,
                recordedId: 20,
                position: 95,
                duration: 100,
                status: 'watched',
                updatedAt: 2,
            });
            assert.equal(updated.position, 95);
            assert.equal(updated.status, 'watched');
            assert.equal(await ds.getRepository(WatchHistory).count(), 1);
        } finally {
            await ds.destroy();
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
