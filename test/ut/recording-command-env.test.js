'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    recordingCommandIdentityEnv,
    resolveRecordingFinishCommand,
} = require('../../dist/model/operator/externalCommand/ExternalCommandManageModel');

test('録画系外部コマンドの予約 ID とルール ID は常に文字列で渡す', () => {
    assert.deepEqual(recordingCommandIdentityEnv(12, 34), { RESERVEID: '12', RULEID: '34' });
    assert.deepEqual(recordingCommandIdentityEnv(null, null), { RESERVEID: '', RULEID: '' });
});

test('録画終了コマンドは登録名で選び、未登録・null は既定へ戻す', () => {
    const commands = [
        { name: 'archive', cmd: 'archive.cmd' },
        { name: 'notify', cmd: 'notify.cmd' },
    ];
    assert.deepEqual(resolveRecordingFinishCommand('notify', commands, 'default.cmd'), {
        command: 'notify.cmd',
        isUnknownName: false,
    });
    assert.deepEqual(resolveRecordingFinishCommand('removed', commands, 'default.cmd'), {
        command: 'default.cmd',
        isUnknownName: true,
    });
    assert.deepEqual(resolveRecordingFinishCommand(null, commands, 'default.cmd'), {
        command: 'default.cmd',
        isUnknownName: false,
    });
});
