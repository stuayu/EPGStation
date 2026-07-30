'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    canSupervisorRestart,
    describeRestart,
    detectSupervisor,
    getWindowsServiceName,
} = require('../../dist/model/update/UpdateEnvironment');

const input = (override = {}) => ({
    env: {},
    platform: 'linux',
    hasDockerEnvFile: false,
    isWindowsService: false,
    ...override,
});

test('docker is detected by /.dockerenv or the container env', () => {
    assert.equal(detectSupervisor(input({ hasDockerEnvFile: true })), 'docker');
    assert.equal(detectSupervisor(input({ env: { container: 'docker' } })), 'docker');
});

test('pm2 is detected by the pm_id it passes to the process', () => {
    assert.equal(detectSupervisor(input({ env: { pm_id: '0' } })), 'pm2');
    assert.equal(detectSupervisor(input({ env: { PM2_HOME: '/root/.pm2' } })), 'pm2');
});

test('systemd is detected by INVOCATION_ID / JOURNAL_STREAM', () => {
    assert.equal(detectSupervisor(input({ env: { INVOCATION_ID: 'abc' } })), 'systemd');
    assert.equal(detectSupervisor(input({ env: { JOURNAL_STREAM: '8:12345' } })), 'systemd');
});

test('windows service is detected only on win32', () => {
    assert.equal(detectSupervisor(input({ platform: 'win32', isWindowsService: true })), 'windows-service');
    // 対話的なコンソールがある Windows は手動起動とみなす
    assert.equal(detectSupervisor(input({ platform: 'win32', isWindowsService: false })), 'none');
    assert.equal(detectSupervisor(input({ platform: 'linux', isWindowsService: true })), 'none');
});

test('docker wins over the other markers (compose can set them all)', () => {
    assert.equal(
        detectSupervisor(input({ hasDockerEnvFile: true, env: { pm_id: '0', INVOCATION_ID: 'abc' } })),
        'docker',
    );
});

test('only an unsupervised process needs to spawn its own successor', () => {
    assert.equal(canSupervisorRestart('none'), false);
    for (const supervisor of ['docker', 'systemd', 'pm2', 'windows-service']) {
        assert.equal(canSupervisorRestart(supervisor), true);
    }
});

test('EPGSTATION_SERVICE_MANAGER overrides the heuristics', () => {
    // サービス登録スクリプトが書き込む値。自動判定より優先する
    assert.equal(
        detectSupervisor(input({ platform: 'win32', env: { EPGSTATION_SERVICE_MANAGER: 'windows-service' } })),
        'windows-service',
    );
    // docker のマーカーがあっても明示指定が勝つ
    assert.equal(
        detectSupervisor(input({ hasDockerEnvFile: true, env: { EPGSTATION_SERVICE_MANAGER: 'systemd' } })),
        'systemd',
    );
    // 明示的に none にすれば自前で後継プロセスを起動する動作を選べる
    assert.equal(
        detectSupervisor(input({ platform: 'win32', isWindowsService: true, env: { EPGSTATION_SERVICE_MANAGER: 'none' } })),
        'none',
    );
    // 未知の値は無視して自動判定へ落とす
    assert.equal(detectSupervisor(input({ hasDockerEnvFile: true, env: { EPGSTATION_SERVICE_MANAGER: 'foo' } })), 'docker');
});

test('windows service name falls back to the default', () => {
    assert.equal(getWindowsServiceName({}), 'epgstation');
    assert.equal(getWindowsServiceName({ EPGSTATION_WIN_SERVICE_NAME: 'epgstation-sub' }), 'epgstation-sub');
    // sc start に渡すためシェルへ影響する文字は受け付けない
    assert.equal(getWindowsServiceName({ EPGSTATION_WIN_SERVICE_NAME: 'a & calc' }), 'epgstation');
    assert.equal(getWindowsServiceName({ EPGSTATION_WIN_SERVICE_NAME: '' }), 'epgstation');
});

test('every supervisor has an explanation for the UI', () => {
    for (const supervisor of ['docker', 'systemd', 'pm2', 'windows-service', 'none']) {
        assert.ok(describeRestart(supervisor).length > 0);
    }
});
