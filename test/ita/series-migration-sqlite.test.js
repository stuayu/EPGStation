'use strict';const assert=require('node:assert/strict');const{spawnSync}=require('node:child_process');const test=require('node:test');const{AddSeriesCore1785062000000}=require('../../dist/db/migrations/sqlite/1785062000000-AddSeriesCore');test('series sqlite migration creates and removes all tables',async()=>{const up=[],down=[],m=new AddSeriesCore1785062000000();await m.up({query:async s=>up.push(s)});await m.down({query:async s=>down.push(s)});const py=`import sqlite3,json,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for s in p['up']:d.execute(s)
n={x[0] for x in d.execute("select name from sqlite_master where type='table'")}
assert {'series','series_episode','recorded_series_link'}<=n
for s in p['down']:d.execute(s)
`;const x=spawnSync('python3',['-c',py],{input:JSON.stringify({up,down}),encoding:'utf8'});assert.equal(x.status,0,x.stderr);});
