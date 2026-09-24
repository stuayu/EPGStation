'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAddTaskCommand } = require('../../dist/model/amatsukaze/AmatsukazeCommandUtil');
const { resolveAmatsukazeConfig } = require('../../dist/model/amatsukaze/AmatsukazeConfigResolver');

const build = (amatsukaze = {}, monoPath = null) => {
    const config = resolveAmatsukazeConfig({
        amatsukaze: {
            addTaskPath: '/Amatsukaze/AmatsukazeAddTask',
            monoPath,
            ...amatsukaze,
        },
    });

    return buildAddTaskCommand(config, '高画質', '/media/recorded/input.ts', '/media/recorded');
};

test('ランチャー未指定なら従来どおり addTaskPath を直接実行する', () => {
    const command = build();

    assert.equal(command.bin, '/Amatsukaze/AmatsukazeAddTask');
    assert.deepEqual(command.args.slice(0, 2), ['-f', '/media/recorded/input.ts']);
});

test('ランチャー指定時はランチャー引数の後へ addTaskPath を渡す', () => {
    const command = build({ addTaskLauncher: ['docker', 'exec', 'amatsukaze'] });

    assert.equal(command.bin, 'docker');
    assert.deepEqual(command.args.slice(0, 3), ['exec', 'amatsukaze', '/Amatsukaze/AmatsukazeAddTask']);
});

test('ランチャーと monoPath 併用時は monoPath を addTaskPath より前へ渡す', () => {
    const command = build({ addTaskLauncher: ['docker', 'exec', 'amatsukaze'] }, '/usr/bin/mono');

    assert.deepEqual(command.args.slice(0, 4), [
        'exec',
        'amatsukaze',
        '/usr/bin/mono',
        '/Amatsukaze/AmatsukazeAddTask',
    ]);
});

test('AddTask の既存オプションと値を維持する', () => {
    const command = build({
        amatsukazeRoot: '/Amatsukaze',
        noMove: true,
        priority: 2,
        host: 'server',
        port: 32769,
    });

    assert.deepEqual(command.args, [
        '-f', '/media/recorded/input.ts',
        '-ip', 'server',
        '-p', '32769',
        '-o', '/media/recorded',
        '-s', '高画質',
        '--priority', '2',
        '-r', '/Amatsukaze',
        '--no-move',
    ]);
});

test('monoPath 単独時は従来どおり mono の後へ addTaskPath を渡す', () => {
    const command = build({}, '/usr/bin/mono');

    assert.equal(command.bin, '/usr/bin/mono');
    assert.equal(command.args[0], '/Amatsukaze/AmatsukazeAddTask');
});
