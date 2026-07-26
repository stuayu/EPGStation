'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { AddWatchHistory1785060020000 } = require('../../dist/db/migrations/mysql/1785060020000-AddWatchHistory');
const { AddWatchHistory1785060010000 } = require('../../dist/db/migrations/postgres/1785060010000-AddWatchHistory');

for (const [database, Migration] of [
    ['mysql', AddWatchHistory1785060020000],
    ['postgres', AddWatchHistory1785060010000],
]) {
    test(`${database} watch-history migration has reversible indexed DDL`, async () => {
        const up = [];
        const down = [];
        const migration = new Migration();
        await migration.up({ query: async sql => up.push(sql) });
        await migration.down({ query: async sql => down.push(sql) });
        const ddl = up.join('\n');
        assert.match(ddl, /watch_history/);
        assert.match(ddl, /videoFileId/);
        assert.match(ddl, /recordedId/);
        assert.match(ddl, /IDX_watch_history_video_file_id/);
        assert.match(down.join('\n'), /DROP TABLE/);
    });
}
