'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordedTagDB = require('../../dist/model/db/RecordedTagDB').default;

class FakeQueryBuilder {
    constructor(rows) {
        this.rows = rows;
        this._where = null;
        this._set = null;
    }
    where(cond) {
        this._where = cond;
        return this;
    }
    set(values) {
        this._set = values;
        return this;
    }
    update() {
        return this;
    }
    async getOne() {
        return this.rows.find(r => r.id === this._where.id);
    }
    async getMany() {
        return this.rows;
    }
    async execute() {
        const row = this.rows.find(r => r.id === this._where.id);
        if (row) {
            Object.assign(row, this._set);
        }
        return { raw: [], affected: 1 };
    }
}

class FakeConnection {
    constructor(rows) {
        this.rows = rows;
    }
    getRepository() {
        return { createQueryBuilder: () => new FakeQueryBuilder(this.rows) };
    }
    createQueryBuilder() {
        return new FakeQueryBuilder(this.rows);
    }
}

const makeDB = rows => {
    const op = { getConnection: async () => new FakeConnection(rows) };
    const promiseRetry = { run: fn => fn() };
    return new RecordedTagDB(op, promiseRetry);
};

// chain: 1 -> 2 -> 3 (3 は 1 の孫)
const baseRows = () => [
    { id: 1, name: 'a', halfWidthName: 'a', color: '#fff', parentId: null },
    { id: 2, name: 'b', halfWidthName: 'b', color: '#fff', parentId: 1 },
    { id: 3, name: 'c', halfWidthName: 'c', color: '#fff', parentId: 2 },
];

test('getDescendantIds returns all descendants recursively', async () => {
    const db = makeDB(baseRows());
    const descendants = await db.getDescendantIds(1);
    assert.deepEqual(descendants.sort(), [2, 3]);
    assert.deepEqual(await db.getDescendantIds(3), []);
});

test('updateOnce rejects setting a tag as its own parent', async () => {
    const db = makeDB(baseRows());
    await assert.rejects(() => db.updateOnce(1, 'a', '#fff', 1), /RecordedTagCircularParent/);
});

test('updateOnce rejects setting a descendant as the parent (circular reference)', async () => {
    const db = makeDB(baseRows());
    await assert.rejects(() => db.updateOnce(1, 'a', '#fff', 3), /RecordedTagCircularParent/);
});

test('updateOnce rejects a non-existent parentId', async () => {
    const db = makeDB(baseRows());
    await assert.rejects(() => db.updateOnce(1, 'a', '#fff', 999), /RecordedTagParentIsNull/);
});

test('updateOnce allows re-parenting to a valid non-descendant tag and clearing to null', async () => {
    const rows = baseRows();
    const db = makeDB(rows);
    await db.updateOnce(3, 'c', '#fff', 1);
    assert.equal(rows.find(r => r.id === 3).parentId, 1);

    await db.updateOnce(3, 'c', '#fff', null);
    assert.equal(rows.find(r => r.id === 3).parentId, null);
});

test('updateOnce without parentId leaves the hierarchy untouched', async () => {
    const rows = baseRows();
    const db = makeDB(rows);
    await db.updateOnce(2, 'renamed', '#000');
    const row = rows.find(r => r.id === 2);
    assert.equal(row.name, 'renamed');
    assert.equal(row.parentId, 1);
});
