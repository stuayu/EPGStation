'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');

const clientRequire = createRequire(path.resolve(__dirname, '../../client/package.json'));
const ts = clientRequire('typescript');

const loadClientUtil = () => {
    const utilPath = path.resolve(__dirname, '../../client/src/util/Util.ts');
    const source = fs.readFileSync(utilPath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(clientRequire, module, module.exports);
    return module.exports.default;
};

test('録画検索は同じ条件でも再検索を要求すればルートを更新する', async () => {
    const Util = loadClientUtil();
    const pushes = [];
    const router = {
        currentRoute: {
            value: {
                path: '/recorded',
                query: { keyword: 'same keyword', timestamp: 'old' },
            },
        },
        push: async location => pushes.push(location),
    };

    await Util.move(router, { path: '/recorded', query: { keyword: 'same keyword' } }, true);

    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].path, '/recorded');
    assert.equal(pushes[0].query.keyword, 'same keyword');
    assert.notEqual(pushes[0].query.timestamp, 'old');
});

test('通常の同一ルート遷移は従来どおり省略する', async () => {
    const Util = loadClientUtil();
    let pushCount = 0;
    const router = {
        currentRoute: {
            value: {
                path: '/recorded',
                query: { keyword: 'same keyword', timestamp: 'old' },
            },
        },
        push: async () => {
            pushCount++;
        },
    };

    await Util.move(router, { path: '/recorded', query: { keyword: 'same keyword' } });

    assert.equal(pushCount, 0);
});
