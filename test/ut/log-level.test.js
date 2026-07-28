'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveLogLevels, LOG_CATEGORIES, LOG_LEVELS } = require('../../dist/model/log/LogLevel');
const LogLevelApplier = require('../../dist/model/log/LogLevelApplier').default;

test('log levels are read per category', () => {
    const levels = resolveLogLevels({ levels: { system: 'debug', access: 'off' } });
    assert.deepEqual(levels, { system: 'debug', access: 'off' });
});

test('unknown categories and invalid levels are dropped instead of breaking logging', () => {
    const levels = resolveLogLevels({ levels: { system: 'verbose', unknown: 'debug', stream: 'trace' } });
    assert.deepEqual(levels, { stream: 'trace' });
    assert.deepEqual(resolveLogLevels(undefined), {});
    assert.deepEqual(resolveLogLevels(null), {});
    assert.deepEqual(resolveLogLevels('debug'), {});
    assert.deepEqual(resolveLogLevels({ levels: [] }), {});
});

test('every category and level the UI offers is accepted', () => {
    const levels = Object.fromEntries(LOG_CATEGORIES.map(c => [c, 'warn']));
    assert.deepEqual(resolveLogLevels({ levels }), levels);
    for (const level of LOG_LEVELS) {
        assert.deepEqual(resolveLogLevels({ levels: { system: level } }), { system: level });
    }
});

/**
 * log4js のロガーは level を代入するだけで切り替わるので、
 * 適用側は「指定されたカテゴリだけ書き換える」ことを保証すればよい
 */
function loggerFixture() {
    const logger = {
        system: { level: 'info', info: () => {} },
        access: { level: 'info' },
        stream: { level: 'info' },
        encode: { level: 'info' },
    };
    return { logger, loggerModel: { getLogger: () => logger } };
}

test('only the specified categories are overridden', async () => {
    const { logger, loggerModel } = loggerFixture();
    const db = { getAll: async () => ({ logging: { levels: { system: 'debug', encode: 'off' } } }) };
    await new LogLevelApplier(loggerModel, db).apply();

    assert.equal(logger.system.level, 'debug');
    assert.equal(logger.encode.level, 'off');
    // 指定しなかったカテゴリはログ設定ファイルの値のまま
    assert.equal(logger.access.level, 'info');
    assert.equal(logger.stream.level, 'info');
});

test('an unreadable settings table leaves the file based levels alone', async () => {
    const { logger, loggerModel } = loggerFixture();
    const db = {
        getAll: async () => {
            throw new Error('no connection');
        },
    };
    await new LogLevelApplier(loggerModel, db).apply();
    assert.equal(logger.system.level, 'info');
});

test('no stored setting means no change', async () => {
    const { logger, loggerModel } = loggerFixture();
    await new LogLevelApplier(loggerModel, { getAll: async () => ({}) }).apply();
    assert.equal(logger.system.level, 'info');
});
