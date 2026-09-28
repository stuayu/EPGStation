'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/api/recordingPreset/RecordingPresetApiModel').default;

const settings = { parentDirectoryName: 'recorded', directory: 'tv', recordedFormat: '%TITLE%', mode1: 'encode', encodeParentDirectoryName1: 'encoded', directory1: 'out', mode2: null, encodeParentDirectoryName2: null, directory2: null, mode3: null, encodeParentDirectoryName3: null, directory3: null, isDeleteOriginalAfterEncode: false, priority: 3, conflictPolicy: 'STRICT', allowEndLack: true, startMarginSec: 0, endMarginSec: null, tags: [2, 5], finishCommandName: null };
const makeModel = () => {
    let rows = [];
    let id = 0;
    const db = {
        findAll: async () => rows,
        findId: async key => rows.find(x => x.id === key) || null,
        findDefault: async () => rows.find(x => x.isDefault) || null,
        insert: async row => { row.id = ++id; rows.push(row); return row.id; },
        update: async row => { rows[rows.findIndex(x => x.id === row.id)] = row; },
        delete: async key => { rows = rows.filter(x => x.id !== key); },
    };
    return { model: new Model(db), rows: () => rows };
};

test('録画プリセット CRUD が設定値を保持する', async () => {
    const { model } = makeModel();
    const id = await model.create({ name: '標準', settings });
    assert.equal(id, 1);
    assert.deepEqual((await model.get(id)).settings, settings);
    await model.update(id, { name: '更新', settings: { ...settings, priority: 4 } });
    assert.equal((await model.get(id)).name, '更新');
    assert.equal((await model.gets()).total, 1);
    await model.delete(id);
    await assert.rejects(model.get(id), /RecordingPresetIsNotFound/);
});

test('既定プリセットは常に 1 件だけ', async () => {
    const { model, rows } = makeModel();
    const first = await model.create({ name: 'A', settings, isDefault: true });
    const second = await model.create({ name: 'B', settings, isDefault: true });
    assert.deepEqual(rows().filter(x => x.isDefault).map(x => x.id), [second]);
    await model.update(first, { name: 'A', settings, isDefault: true });
    assert.deepEqual(rows().filter(x => x.isDefault).map(x => x.id), [first]);
    assert.equal((await model.getDefault()).id, first);
});

test('既存録画プリセットでコマンド名が未設定なら null として読み出す', async () => {
    const { model } = makeModel();
    const legacySettings = { ...settings };
    delete legacySettings.finishCommandName;

    const id = await model.create({ name: '旧プリセット', settings: legacySettings });

    assert.equal((await model.get(id)).settings.finishCommandName, null);
});

test('名前と録画設定の値を検証する', async () => {
    const { model } = makeModel();
    for (const option of [
        { name: ' ', settings },
        { name: 'bad', settings: { ...settings, priority: 6 } },
        { name: 'bad', settings: { ...settings, conflictPolicy: 'UNKNOWN' } },
        { name: 'bad', settings: { ...settings, startMarginSec: 3601 } },
        { name: 'bad', settings: { ...settings, tags: [0] } },
        { name: 'bad', settings: { ...settings, surprise: true } },
    ]) await assert.rejects(model.create(option), /InvalidRequestBody/);
});
