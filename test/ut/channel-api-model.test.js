'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ChannelApiModel = require('../../dist/model/api/channel/ChannelApiModel').default;

function makeModel(error) {
    const channel = { id: 1, hasLogoData: true };
    const mirakurun = { getLogoImage: async () => {
        if (error !== null) throw error;
        return Buffer.from('png');
    } };
    return new ChannelApiModel(
        { findId: async () => channel },
        { getClient: () => mirakurun },
        {},
        {},
    );
}

test('Mirakurun の 404 はロゴ無しとして NOT_FOUND に変換する', async () => {
    await assert.rejects(makeModel({ response: { status: 404 } }).getLogo(1), { message: 'notfound' });
});

test('一時的な Mirakurun エラーは NOT_FOUND に変換しない', async () => {
    const error = new Error('temporarily unavailable');
    error.status = 503;
    await assert.rejects(makeModel(error).getLogo(1), error);
});
