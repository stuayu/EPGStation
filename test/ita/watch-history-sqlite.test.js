'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { AddWatchHistory1785060000000 } = require('../../dist/db/migrations/sqlite/1785060000000-AddWatchHistory');
const WatchHistoryDB = require('../../dist/model/db/WatchHistoryDB').default;

class MemoryRepository {
    constructor() { this.rows = new Map(); this.nextId = 1; }
    async findOne({ where }) { return this.rows.get(where.videoFileId) ?? null; }
    create(value) { return { ...value }; }
    async save(value) {
        const saved = { ...value, id: value.id ?? this.nextId++ };
        this.rows.set(saved.videoFileId, saved);
        return saved;
    }
    async delete({ videoFileId }) { this.rows.delete(videoFileId); }
}

// WatchHistoryDB.upsert() は find→save の read-modify-write ではなく、レースを避けるために
// createQueryBuilder().insert()...orUpdate() による DB 側の原子的な upsert を使う実装になっている。
// そのため、テスト用の擬似コネクションでも createQueryBuilder チェーンを最小限再現する
function makeConnection(repository) {
    return {
        getRepository: () => repository,
        createQueryBuilder: () => {
            let values = null;
            const builder = {
                insert: () => builder,
                into: () => builder,
                values: v => {
                    values = v;
                    return builder;
                },
                orUpdate: () => builder,
                execute: async () => {
                    const existing = repository.rows.get(values.videoFileId);
                    const saved = { ...(existing ?? {}), ...values, id: existing?.id ?? repository.nextId++ };
                    repository.rows.set(values.videoFileId, saved);
                    return { raw: [], generatedMaps: [] };
                },
            };
            return builder;
        },
    };
}

test('watch-history repository upsert is idempotent', async () => {
    const repository = new MemoryRepository();
    const db = new WatchHistoryDB({ getConnection: async () => makeConnection(repository) });
    await db.upsert({ videoFileId: 10, recordedId: 20, position: 30, duration: 100, status: 'watching', updatedAt: 1 });
    await db.upsert({ videoFileId: 10, recordedId: 20, position: 95, duration: 100, status: 'watched', updatedAt: 2 });
    const row = await db.findByVideoFileId(10);
    assert.equal(row.position, 95);
    assert.equal(row.status, 'watched');
    assert.equal(repository.rows.size, 1);
});

test('sqlite migration applies and rolls back on a real sqlite engine', async () => {
    const up = [];
    const down = [];
    const migration = new AddWatchHistory1785060000000();
    await migration.up({ query: async sql => up.push(sql) });
    await migration.down({ query: async sql => down.push(sql) });
    const python = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
for sql in payload['up']: db.execute(sql)
cols=[row[1] for row in db.execute("PRAGMA table_info('watch_history')")]
indexes=[row[1] for row in db.execute("PRAGMA index_list('watch_history')")]
assert cols == ['id','videoFileId','recordedId','userId','position','duration','status','updatedAt'], cols
assert 'IDX_watch_history_video_file_id' in indexes
assert 'IDX_watch_history_recorded_id' in indexes
for sql in payload['down']: db.execute(sql)
assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='watch_history'").fetchone()[0] == 0
`;
    const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ up, down }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
