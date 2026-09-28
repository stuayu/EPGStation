'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { recordingCommandIdentityEnv } = require('../../dist/model/operator/externalCommand/ExternalCommandManageModel');

test('録画系外部コマンドの予約 ID とルール ID は常に文字列で渡す', () => {
    assert.deepEqual(recordingCommandIdentityEnv(12, 34), { RESERVEID: '12', RULEID: '34' });
    assert.deepEqual(recordingCommandIdentityEnv(null, null), { RESERVEID: '', RULEID: '' });
});
