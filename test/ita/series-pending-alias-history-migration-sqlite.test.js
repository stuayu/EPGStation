'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { AddRecordedSeriesLinkChannelId1785070000000 } = require('../../dist/db/migrations/sqlite/1785070000000-AddRecordedSeriesLinkChannelId');
const { AddSeriesPendingMatch1785071000000 } = require('../../dist/db/migrations/sqlite/1785071000000-AddSeriesPendingMatch');
const { AddSeriesAlias1785072000000 } = require('../../dist/db/migrations/sqlite/1785072000000-AddSeriesAlias');
const { AddSeriesChangeHistory1785073000000 } = require('../../dist/db/migrations/sqlite/1785073000000-AddSeriesChangeHistory');

async function migrate(migrationClass) {
    const up = [],
        down = [];
    const m = new migrationClass();
    await m.up({ query: async s => up.push(s) });
    await m.down({ query: async s => down.push(s) });
    return { up, down };
}

test('sqlite migrations for pending/alias/history queue create and remove their tables (idempotent order)', async () => {
    const channelId = await migrate(AddRecordedSeriesLinkChannelId1785070000000);
    const pending = await migrate(AddSeriesPendingMatch1785071000000);
    const alias = await migrate(AddSeriesAlias1785072000000);
    const history = await migrate(AddSeriesChangeHistory1785073000000);
    const py = `import sqlite3,json,sys
p=json.load(sys.stdin)
d=sqlite3.connect(':memory:')
d.execute("create table recorded (id integer primary key, channelId integer)")
d.execute("create table recorded_series_link (id integer primary key, recordedId integer, seriesId integer)")
d.execute("create table series (id integer primary key)")
for s in p['channelId_up']:d.execute(s)
for s in p['pending_up']:d.execute(s)
for s in p['alias_up']:d.execute(s)
for s in p['history_up']:d.execute(s)
n={x[0] for x in d.execute("select name from sqlite_master where type='table'")}
assert {'series_pending_match','series_alias','series_change_history'}<=n, n
# 逆順で down を適用してもエラーにならないこと
for s in p['history_down']:d.execute(s)
for s in p['alias_down']:d.execute(s)
for s in p['pending_down']:d.execute(s)
`;
    const payload = {
        channelId_up: channelId.up,
        pending_up: pending.up,
        alias_up: alias.up,
        history_up: history.up,
        history_down: history.down,
        alias_down: alias.down,
        pending_down: pending.down,
    };
    const x = spawnSync('python3', ['-c', py], { input: JSON.stringify(payload), encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
});
