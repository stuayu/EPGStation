'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const ConnectionCheckModel = require('../../dist/model/ConnectionCheckModel').default;

const createModel = ({ getStatusImpl, getDocsImpl }) => {
    const warnLogs = [];
    const logger = {
        getLogger: () => ({
            system: {
                info: () => {},
                debug: () => {},
                warn: msg => warnLogs.push(String(msg)),
                error: () => {},
                fatal: () => {},
            },
        }),
    };
    const mirakurunClient = {
        getStatus: getStatusImpl,
        getDocs: getDocsImpl ?? (async () => ({})),
    };
    const mirakurunClientModel = { getClient: () => mirakurunClient };
    const dbOperator = { checkConnection: async () => {} };

    return {
        model: new ConnectionCheckModel(logger, mirakurunClientModel, dbOperator),
        warnLogs,
    };
};

test('getStatus() が成功すれば true を返し、リトライやログは発生しない', async () => {
    const { model, warnLogs } = createModel({
        getStatusImpl: async () => ({}),
    });

    const result = await model.checkMirakurun();

    assert.equal(result, true);
    assert.equal(warnLogs.length, 0);
});

test('operationId とは無関係なエラーでは docs に関する追加ログを出さない', async () => {
    const { model, warnLogs } = createModel({
        getStatusImpl: async () => {
            throw new Error('ECONNREFUSED');
        },
    });

    const result = await model.checkMirakurun();

    assert.equal(result, false);
    assert.equal(
        warnLogs.some(msg => msg.includes('/docs')),
        false,
    );
});

test('operationId 解決失敗のエラーでは docs は取得できたが内容が一致しない旨のログを出す', async () => {
    const { model, warnLogs } = createModel({
        getStatusImpl: async () => {
            throw new Error('operationId "getStatus" is not found.');
        },
        getDocsImpl: async () => ({ paths: {} }),
    });

    const result = await model.checkMirakurun();

    assert.equal(result, false);
    assert.equal(
        warnLogs.some(msg => msg.includes('/docs') && msg.includes('一致しない')),
        true,
    );
});

test('operationId 解決失敗かつ docs 自体も取得できない場合は docs が取得できない旨のログを出す', async () => {
    const { model, warnLogs } = createModel({
        getStatusImpl: async () => {
            throw new Error('operationId "getStatus" is not found.');
        },
        getDocsImpl: async () => {
            throw new Error('Failed to get "/docs".');
        },
    });

    const result = await model.checkMirakurun();

    assert.equal(result, false);
    assert.equal(
        warnLogs.some(msg => msg.includes('/docs') && msg.includes('取得できない')),
        true,
    );
});

test('checkDB() は接続確認に失敗している間リトライし、成功したら戻る', async () => {
    let attempts = 0;
    const logger = {
        getLogger: () => ({
            system: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
        }),
    };
    const mirakurunClientModel = { getClient: () => ({}) };
    const dbOperator = {
        checkConnection: async () => {
            attempts++;
            if (attempts < 2) {
                throw new Error('not yet connected');
            }
        },
    };
    const model = new ConnectionCheckModel(logger, mirakurunClientModel, dbOperator);

    await model.checkDB();

    assert.equal(attempts, 2);
});

test('docs エンドポイントが 404 の場合も docs 起因のログを出す', async () => {
    const { model, warnLogs } = createModel({
        getStatusImpl: async () => {
            throw { status: 404, statusText: 'Not Found' };
        },
        getDocsImpl: async () => {
            throw { status: 404, statusText: 'Not Found' };
        },
    });

    const result = await model.checkMirakurun();

    assert.equal(result, false);
    assert.equal(
        warnLogs.some(msg => msg.includes('/docs')),
        true,
    );
});
