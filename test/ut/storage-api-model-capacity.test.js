'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const StorageApiModel = require('../../dist/model/api/storage/StorageApiModel').default;

test('保存先 API は未来の実行可能予約だけを容量見込みへ加える', async () => {
    const now = Date.now();
    const reservation = (id, patch = {}) => ({
        id,
        startAt: now + 60_000 + id,
        endAt: now + 120_000 + id,
        channelType: 'GR',
        isSkip: false,
        isConflict: false,
        plannedTunerIndex: 0,
        startMarginSec: 1,
        endMarginSec: 2,
        programId: 10,
        parentDirectoryName: null,
        ...patch,
    });
    const rows = [
        reservation(1, { plannedTunerIndex: null, name: 'legacy reservation' }),
        reservation(2, { isSkip: true }),
        reservation(3, { isConflict: true }),
        reservation(4, { plannedTunerIndex: null }),
        reservation(5, { startAt: now - 1 }),
    ];
    const config = {
        recorded: [{ name: 'primary', path: process.cwd() }],
        recording: { storageFallbackBitrateMbps: 8, storageFallbackMarginMB: 0 },
        timeSpecifiedStartMargin: 0,
        timeSpecifiedEndMargin: 0,
    };
    const model = new StorageApiModel(
        { getConfig: () => config },
        { findFutureForStorage: async now => rows.filter(row => row.startAt > now) },
        { findIds: async ids => {
            assert.deepEqual(ids, [10]);
            return [{ id: 10, duration: 1000 }];
        }, findId: async () => assert.fail('findId must not be called') },
    );
    const result = await model.getInfo();
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].reservedEstimatedSize, 8_000_000);
    assert.equal(result.items[0].firstShortfallReserveName, undefined);
});
