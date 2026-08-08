'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const EPGUpdateManageModel = require('../../dist/model/epgUpdater/EPGUpdateManageModel').default;
const { TunerServerType } = require('../../dist/model/epgUpdater/IEPGUpdateManageModel');

const createModel = (config = {}, getServerConfigImpl = async () => ({})) => {
    const calls = { getServerConfig: 0 };
    const logger = {
        getLogger: () => ({
            system: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
        }),
    };
    const configuration = { getConfig: () => Object.assign({ mirakurunPath: 'http://localhost:40772' }, config) };
    const mirakurunClient = {
        getServerConfig: async () => {
            calls.getServerConfig++;

            return getServerConfigImpl();
        },
    };
    const mirakurunClientModel = { getClient: () => mirakurunClient };
    const channelDB = {};
    const programDB = {};

    return {
        model: new EPGUpdateManageModel(logger, configuration, mirakurunClientModel, channelDB, programDB),
        calls,
    };
};

test('getServerConfig() が成功したら mirakurun と判定してキャッシュする', async () => {
    const { model, calls } = createModel();

    const result1 = await model.checkTunerServerType();
    const result2 = await model.checkTunerServerType();

    assert.equal(result1, TunerServerType.mirakurun);
    assert.equal(result2, TunerServerType.mirakurun);
    // 2 回目はキャッシュを返すため getServerConfig() は 1 回しか呼ばれない
    assert.equal(calls.getServerConfig, 1);
});

test('operationId が解決できないエラー (docs 起因) は mirakc と判定してキャッシュする', async () => {
    const { model, calls } = createModel({}, async () => {
        throw new Error('operationId "getServerConfig" is not found.');
    });

    const result1 = await model.checkTunerServerType();
    const result2 = await model.checkTunerServerType();

    assert.equal(result1, TunerServerType.mirakc);
    assert.equal(result2, TunerServerType.mirakc);
    assert.equal(calls.getServerConfig, 1);
});

test('404 応答は mirakc と判定してキャッシュする', async () => {
    const { model, calls } = createModel({}, async () => {
        throw { status: 404, statusText: 'Not Found' };
    });

    const result1 = await model.checkTunerServerType();
    const result2 = await model.checkTunerServerType();

    assert.equal(result1, TunerServerType.mirakc);
    assert.equal(result2, TunerServerType.mirakc);
    assert.equal(calls.getServerConfig, 1);
});

test('501 応答は mirakc と判定してキャッシュする', async () => {
    const { model, calls } = createModel({}, async () => {
        throw { status: 501, statusText: 'Not Implemented' };
    });

    await model.checkTunerServerType();
    await model.checkTunerServerType();

    assert.equal(calls.getServerConfig, 1);
});

test('接続不能 (status: -1) は mirakc とみなすが、確定判定としてキャッシュせず再判定できる', async () => {
    const { model, calls } = createModel({}, async () => {
        throw { status: -1, statusText: 'Request Failure' };
    });

    const result1 = await model.checkTunerServerType();
    const result2 = await model.checkTunerServerType();

    assert.equal(result1, TunerServerType.mirakc);
    assert.equal(result2, TunerServerType.mirakc);
    // キャッシュされていなければ毎回 getServerConfig() が呼ばれる
    assert.equal(calls.getServerConfig, 2);
});

test('5xx 応答は一時的な失敗とみなし、キャッシュせず再判定できる', async () => {
    const { model, calls } = createModel({}, async () => {
        throw { status: 503, statusText: 'Service Unavailable' };
    });

    await model.checkTunerServerType();
    await model.checkTunerServerType();

    assert.equal(calls.getServerConfig, 2);
});

test('タイムアウト (Error のみで status を持たない) も一時的な失敗としてキャッシュしない', async () => {
    const { model, calls } = createModel({}, async () => {
        throw new Error('TimeoutError');
    });

    await model.checkTunerServerType();
    await model.checkTunerServerType();

    assert.equal(calls.getServerConfig, 2);
});

test('一時的な失敗の後、次回サーバーが復旧すれば mirakurun と判定してキャッシュする', async () => {
    let shouldFail = true;
    const { model, calls } = createModel({}, async () => {
        if (shouldFail) {
            throw { status: -1, statusText: 'Request Failure' };
        }

        return {};
    });

    const result1 = await model.checkTunerServerType();
    assert.equal(result1, TunerServerType.mirakc);

    shouldFail = false;
    const result2 = await model.checkTunerServerType();
    assert.equal(result2, TunerServerType.mirakurun);
    assert.equal(calls.getServerConfig, 2);
});

test('config.yml で mirakurun を明示指定すると getServerConfig() を呼ばずに確定する', async () => {
    const { model, calls } = createModel({ tunerServerType: 'mirakurun' });

    const result = await model.checkTunerServerType();

    assert.equal(result, TunerServerType.mirakurun);
    assert.equal(calls.getServerConfig, 0);
});

test('config.yml で mirakc を明示指定すると getServerConfig() を呼ばずに確定する', async () => {
    const { model, calls } = createModel({ tunerServerType: 'mirakc' });

    const result = await model.checkTunerServerType();

    assert.equal(result, TunerServerType.mirakc);
    assert.equal(calls.getServerConfig, 0);
});

test('message も status も持たないエラーは一時的な失敗として扱われる (フォールバック整形)', async () => {
    const { model, calls } = createModel({}, async () => {
        // eslint-disable-next-line no-throw-literal
        throw { foo: 'bar' };
    });

    const result1 = await model.checkTunerServerType();
    const result2 = await model.checkTunerServerType();

    assert.equal(result1, TunerServerType.mirakc);
    assert.equal(result2, TunerServerType.mirakc);
    // キャッシュされていなければ毎回 getServerConfig() が呼ばれる
    assert.equal(calls.getServerConfig, 2);
});

test('start() は tunerServerType が mirakurun のとき mirakurun 用の解析処理を呼ぶ', async () => {
    const { model } = createModel({ tunerServerType: 'mirakurun' });
    let called = false;
    model.startAnalayzingMirakurunEvents = async () => {
        called = true;
    };
    model.startAnalyzingMirakcEvents = async () => {
        throw new Error('should not be called');
    };

    await model.start();

    assert.equal(called, true);
});

test('start() は tunerServerType が mirakc のとき mirakc 用の解析処理を呼ぶ', async () => {
    const { model } = createModel({ tunerServerType: 'mirakc' });
    let called = false;
    model.startAnalayzingMirakurunEvents = async () => {
        throw new Error('should not be called');
    };
    model.startAnalyzingMirakcEvents = async () => {
        called = true;
    };

    await model.start();

    assert.equal(called, true);
});

test('config.yml で auto を指定した場合は従来通り自動判定する', async () => {
    const { model, calls } = createModel({ tunerServerType: 'auto' });

    const result = await model.checkTunerServerType();

    assert.equal(result, TunerServerType.mirakurun);
    assert.equal(calls.getServerConfig, 1);
});
