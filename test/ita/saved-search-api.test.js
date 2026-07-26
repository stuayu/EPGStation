'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const SavedSearchApiModel = require('../../dist/model/api/savedSearch/SavedSearchApiModel').default;

const config = enabled => ({ getConfig: () => ({ featureFlags: { advancedSearch: enabled } }) });

class MemorySavedSearchDB {
    constructor() {
        this.rows = new Map();
        this.nextId = 1;
    }
    async insertOnce(item) {
        const id = this.nextId++;
        this.rows.set(id, { ...item, id });
        return id;
    }
    async updateOnce(item) {
        this.rows.set(item.id, { ...this.rows.get(item.id), ...item });
    }
    async deleteOnce(id) {
        this.rows.delete(id);
    }
    async findId(id) {
        return this.rows.get(id) ?? null;
    }
    async findAll() {
        const all = [...this.rows.values()];
        return [all, all.length];
    }
}

test('saved search API is disabled while advancedSearch flag is off', async () => {
    const model = new SavedSearchApiModel(config(false), new MemorySavedSearchDB());
    await assert.rejects(() => model.gets(), /AdvancedSearchFeatureIsDisabled/);
    await assert.rejects(() => model.create({ name: 'a', query: 'foo' }), /AdvancedSearchFeatureIsDisabled/);
});

test('saved search API performs full CRUD when the flag is on', async () => {
    const db = new MemorySavedSearchDB();
    const model = new SavedSearchApiModel(config(true), db);

    const searchId = await model.create({ name: 'anime', query: 'tag:anime', isPinned: true });
    const created = await model.get(searchId);
    assert.equal(created.name, 'anime');
    assert.equal(created.isPinned, true);

    await model.update(searchId, { name: 'anime2', query: 'tag:anime2', isPinned: false });
    const updated = await model.get(searchId);
    assert.equal(updated.name, 'anime2');
    assert.equal(updated.isPinned, false);

    const list = await model.gets();
    assert.equal(list.total, 1);

    await model.delete(searchId);
    await assert.rejects(() => model.get(searchId), /SavedSearchIsNull/);
});
