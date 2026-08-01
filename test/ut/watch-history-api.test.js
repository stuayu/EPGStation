'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const WatchHistoryApiModel = require('../../dist/model/api/video/WatchHistoryApiModel').default;

const enabledConfig = { getConfig: () => ({ featureFlags: { watchHistory: true } }) };
const disabledConfig = { getConfig: () => ({ featureFlags: { watchHistory: false } }) };

function makeModel(options) {
    const opt = options || {};
    const deleted = [];
    const db = {
        findRecent: async o => {
            opt.lastFindOption = o;
            return [opt.histories ?? [], opt.total ?? (opt.histories ?? []).length];
        },
        findByVideoFileId: async () => null,
        upsert: async () => ({}),
        deleteByVideoFileId: async id => deleted.push(id),
    };
    const recordedApiModel = {
        get: async id => opt.recorded?.[id] ?? null,
    };
    return {
        model: new WatchHistoryApiModel(opt.config ?? enabledConfig, db, { findId: async () => null }, { enqueueFromWatchHistory: () => {} }, recordedApiModel),
        deleted,
        option: opt,
    };
}

test('視聴履歴一覧に対象の録画情報を添えて返す', async () => {
    const { model } = makeModel({
        histories: [
            { videoFileId: 1, recordedId: 10, position: 30, duration: 100, status: 'watching', updatedAt: 1700000000000 },
            { videoFileId: 2, recordedId: 10, position: 100, duration: 100, status: 'watched', updatedAt: 1600000000000 },
        ],
        total: 2,
        recorded: { 10: { id: 10, name: '番組' } },
    });

    const result = await model.gets({ isHalfWidth: false });

    assert.equal(result.total, 2);
    assert.equal(result.records.length, 2);
    assert.equal(result.records[0].recorded.name, '番組');
    // 同じ録画の履歴でも録画情報は共有される
    assert.equal(result.records[1].recorded.name, '番組');
    assert.equal(result.records[1].status, 'watched');
});

test('録画が削除済みの履歴は recorded を null にして残す', async () => {
    const { model } = makeModel({
        histories: [{ videoFileId: 1, recordedId: 99, position: 0, duration: 0, status: 'watching', updatedAt: 1 }],
        recorded: {},
    });

    const result = await model.gets({ isHalfWidth: false });

    assert.equal(result.records[0].recorded, null);
});

test('視聴状態の絞り込みと件数指定をそのまま DB へ渡す', async () => {
    const { model, option } = makeModel({ histories: [] });

    await model.gets({ isHalfWidth: false, offset: 24, limit: 12, status: 'watched' });

    assert.deepEqual(option.lastFindOption, { limit: 12, offset: 24, status: 'watched' });
});

test('機能フラグが無効なら取得も削除も拒否する', async () => {
    const { model } = makeModel({ config: disabledConfig });

    await assert.rejects(() => model.gets({ isHalfWidth: false }), /WatchHistoryFeatureIsDisabled/);
    await assert.rejects(() => model.delete(1), /WatchHistoryFeatureIsDisabled/);
});

test('視聴履歴を 1 件削除する', async () => {
    const { model, deleted } = makeModel({});

    await model.delete(5);

    assert.deepEqual(deleted, [5]);
});
