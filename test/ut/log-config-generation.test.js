'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const LoggerModel = require('../../dist/model/LoggerModel').default;

/**
 * 用意されていないログ設定ファイルが sample から自動生成されることを確認する。
 * ここが動かないと、まっさらな環境で EPGStation が起動できない
 */
function makeTempConfigDir(t, withSample = true) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-log-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    if (withSample === true) {
        fs.writeFileSync(
            path.join(dir, 'operatorLogConfig.sample.yml'),
            'appenders:\n  system:\n    type: console\ncategories:\n  default:\n    appenders: ["system"]\n    level: info\n',
        );
    }
    return dir;
}

test('a missing log config file is generated from the bundled sample', t => {
    const dir = makeTempConfigDir(t);
    const target = path.join(dir, 'operatorLogConfig.yml');
    assert.equal(fs.existsSync(target), false);

    new LoggerModel().initialize(target);
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.readFileSync(target, 'utf8'), fs.readFileSync(path.join(dir, 'operatorLogConfig.sample.yml'), 'utf8'));
});

test('an existing log config file is never overwritten', t => {
    const dir = makeTempConfigDir(t);
    const target = path.join(dir, 'operatorLogConfig.yml');
    const custom = 'appenders:\n  system:\n    type: console\ncategories:\n  default:\n    appenders: ["system"]\n    level: debug\n';
    fs.writeFileSync(target, custom);

    new LoggerModel().initialize(target);
    assert.equal(fs.readFileSync(target, 'utf8'), custom);
});

test('logging falls back to the console when neither the file nor the sample exists', t => {
    const dir = makeTempConfigDir(t, false);
    const target = path.join(dir, 'operatorLogConfig.yml');

    // 以前は process.exit(1) で起動そのものが止まっていた
    const model = new LoggerModel();
    model.initialize(target);
    assert.equal(fs.existsSync(target), false);
    // ロガーは使える状態になっている
    assert.notEqual(model.getLogger().system, undefined);
});
