'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPowerCommand, buildRtcWakeCommand, decidePowerAction } = require('../../dist/model/power/PowerPolicy');

const config = { enabled: true, afterRecording: 'standby', idleMinutes: 10, minGapMinutes: 30, wakeBeforeSec: 300 };
const activity = { idleSinceAt: -600_000, recordingCount: 0, recordingPreparationCount: 0, encodeRunningCount: 0, encodeWaitingCount: 0, liveStreamCount: 0, recordedStreamCount: 0, heavyTaskRunning: false, nextReservationAt: 3_600_000 };

test('省電力は全処理が停止し予約までの間隔が足りるときだけ許可する', () => {
    assert.deepEqual(decidePowerAction(config, activity, 0), { shouldSuspend: true, reason: 'idle', wakeAt: 3_300_000 });
    for (const key of ['recordingCount', 'recordingPreparationCount', 'encodeRunningCount', 'encodeWaitingCount', 'liveStreamCount', 'recordedStreamCount']) {
        assert.equal(decidePowerAction(config, { ...activity, [key]: 1 }, 0).shouldSuspend, false, key);
    }
    assert.equal(decidePowerAction(config, { ...activity, heavyTaskRunning: true }, 0).shouldSuspend, false);
    assert.equal(decidePowerAction(config, { ...activity, nextReservationAt: 20 * 60_000 }, 0).reason, 'reservation-too-soon');
    assert.equal(decidePowerAction({ ...config, enabled: false }, activity, 0).reason, 'disabled');
    assert.equal(decidePowerAction(config, { ...activity, idleSinceAt: 0 }, 0).reason, 'idle-time-not-reached');
});

test('OS と動作に応じた電源コマンドを組み立てる', () => {
    assert.deepEqual(buildPowerCommand('win32', 'hibernate'), { command: 'shutdown.exe', args: ['/h'] });
    assert.deepEqual(buildPowerCommand('linux', 'standby'), { command: 'systemctl', args: ['suspend'] });
    assert.deepEqual(buildPowerCommand('linux', 'shutdown'), { command: 'shutdown', args: ['-h', 'now'] });
    assert.equal(buildPowerCommand('win32', 'none'), null);
    assert.deepEqual(buildRtcWakeCommand(12_345_000), { command: 'rtcwake', args: ['-m', 'no', '-t', '12345'] });
});
