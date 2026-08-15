'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isSameFilePath,
    resolveAmatsukazeConfig,
    toLocalPath,
    toRemotePath,
} = require('../../dist/model/amatsukaze/AmatsukazeConfigResolver');

test('amatsukaze が未設定でも既定値で解決できる', () => {
    const resolved = resolveAmatsukazeConfig({});

    assert.equal(resolved.host, 'localhost');
    assert.equal(resolved.port, 32768);
    assert.equal(resolved.priority, 3);
    assert.equal(resolved.noMove, true);
    assert.equal(resolved.connectTimeoutMs, 60000);
    assert.equal(resolved.taskTimeoutMs, 0);
    assert.equal(resolved.addTaskPath, null);
    assert.deepEqual(resolved.pathMappings, []);
});

test('範囲外の数値は丸められる', () => {
    const resolved = resolveAmatsukazeConfig({
        amatsukaze: { port: 0, priority: 99, connectTimeoutMs: -1 },
    });

    assert.equal(resolved.port, 1);
    assert.equal(resolved.priority, 5);
    assert.equal(resolved.connectTimeoutMs, 1000);
});

test('数値でない値は既定値に落ちる', () => {
    const resolved = resolveAmatsukazeConfig({
        amatsukaze: { port: 'abc', priority: null },
    });

    assert.equal(resolved.port, 32768);
    assert.equal(resolved.priority, 3);
});

test('空文字のパス設定は未設定として扱われる', () => {
    const resolved = resolveAmatsukazeConfig({
        amatsukaze: { monoPath: '   ', addTaskPath: ' C:\\Amatsukaze\\AddTask.exe ' },
    });

    assert.equal(resolved.monoPath, null);
    assert.equal(resolved.addTaskPath, 'C:\\Amatsukaze\\AddTask.exe');
});

test('noMove は明示的に false のときだけ無効になる', () => {
    assert.equal(resolveAmatsukazeConfig({ amatsukaze: { noMove: false } }).noMove, false);
    assert.equal(resolveAmatsukazeConfig({ amatsukaze: { noMove: true } }).noMove, true);
    assert.equal(resolveAmatsukazeConfig({ amatsukaze: {} }).noMove, true);
});

test('local / remote が欠けたパス変換規則は捨てられる', () => {
    const resolved = resolveAmatsukazeConfig({
        amatsukaze: {
            pathMappings: [{ local: '/mnt/rec', remote: '\\\\nas\\rec' }, { local: '/x' }, { remote: '\\\\nas\\y' }],
        },
    });

    assert.equal(resolved.pathMappings.length, 1);
    assert.equal(resolved.pathMappings[0].local, '/mnt/rec');
});

test('EPGStation のパスを Amatsukaze から見えるパスへ変換できる', () => {
    const mappings = [{ local: '/mnt/recorded', remote: '\\\\nas\\recorded' }];

    assert.equal(toRemotePath('/mnt/recorded/a.ts', mappings), '\\\\nas\\recorded/a.ts');
    // 一致する規則が無ければそのまま
    assert.equal(toRemotePath('/var/other/a.ts', mappings), '/var/other/a.ts');
});

test('Amatsukaze が返したパスを EPGStation のパスへ戻せる', () => {
    const mappings = [{ local: '/mnt/recorded', remote: '\\\\nas\\recorded' }];

    assert.equal(toLocalPath('\\\\nas\\recorded\\out.mp4', mappings), '/mnt/recorded\\out.mp4');
    assert.equal(toLocalPath('/mnt/recorded/out.mp4', mappings), '/mnt/recorded/out.mp4');
});

test('パス区切りと大文字小文字の違いは同じファイルとみなす', () => {
    assert.equal(isSameFilePath('D:\\rec\\A.ts', 'd:/rec/a.ts'), true);
    assert.equal(isSameFilePath('D:\\rec\\a.ts', 'D:\\rec\\b.ts'), false);
});
