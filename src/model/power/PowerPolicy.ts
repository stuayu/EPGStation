export type PowerAction = 'none' | 'standby' | 'hibernate' | 'shutdown';

export interface PowerPolicyConfig {
    enabled: boolean;
    afterRecording: PowerAction;
    idleMinutes: number;
    minGapMinutes: number;
    wakeBeforeSec: number;
}

export interface PowerActivity {
    idleSinceAt: number;
    recordingCount: number;
    recordingPreparationCount: number;
    encodeRunningCount: number;
    encodeWaitingCount: number;
    liveStreamCount: number;
    recordedStreamCount: number;
    heavyTaskRunning: boolean;
    nextReservationAt: number | null;
}

export interface PowerDecision {
    shouldSuspend: boolean;
    reason: string;
    wakeAt: number | null;
}

/**
 * 現在の稼働状況から休止と復帰時刻を決める。
 * @param config 省電力設定
 * @param activity 各プロセスの稼働状況
 * @param now 判定時刻
 * @return 休止可否と復帰予定
 */
export function decidePowerAction(config: PowerPolicyConfig, activity: PowerActivity, now: number): PowerDecision {
    if (config.enabled !== true || config.afterRecording === 'none') {
        return { shouldSuspend: false, reason: 'disabled', wakeAt: null };
    }
    if (
        activity.recordingCount > 0 ||
        activity.recordingPreparationCount > 0 ||
        activity.encodeRunningCount > 0 ||
        activity.encodeWaitingCount > 0 ||
        activity.liveStreamCount > 0 ||
        activity.recordedStreamCount > 0 ||
        activity.heavyTaskRunning === true
    ) {
        return { shouldSuspend: false, reason: 'busy', wakeAt: null };
    }
    if (now - activity.idleSinceAt < config.idleMinutes * 60_000) {
        return { shouldSuspend: false, reason: 'idle-time-not-reached', wakeAt: null };
    }
    const wakeAt =
        activity.nextReservationAt === null ? null : activity.nextReservationAt - config.wakeBeforeSec * 1000;
    if (activity.nextReservationAt !== null && activity.nextReservationAt - now < config.minGapMinutes * 60_000) {
        return { shouldSuspend: false, reason: 'reservation-too-soon', wakeAt };
    }
    return { shouldSuspend: true, reason: 'idle', wakeAt };
}

/**
 * OS と動作から実行コマンドを組み立てる。
 * @param platform OS 名
 * @param action 実行動作
 * @return コマンドと引数
 */
export function buildPowerCommand(
    platform: NodeJS.Platform,
    action: PowerAction,
): { command: string; args: string[] } | null {
    if (action === 'none') return null;
    if (platform === 'win32') {
        if (action === 'standby') return { command: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] };
        if (action === 'hibernate') return { command: 'shutdown.exe', args: ['/h'] };
        return { command: 'shutdown.exe', args: ['/s', '/t', '0'] };
    }
    if (action === 'standby') return { command: 'systemctl', args: ['suspend'] };
    if (action === 'hibernate') return { command: 'systemctl', args: ['hibernate'] };
    return { command: 'shutdown', args: ['-h', 'now'] };
}

/**
 * 次の録画時刻に合わせた rtcwake コマンドを組み立てる。
 * @param wakeAt 復帰時刻 (Unix ms)
 * @param now 現在時刻 (Unix ms)
 * @return コマンドと引数
 */
export function buildRtcWakeCommand(wakeAt: number): { command: string; args: string[] } {
    return { command: 'rtcwake', args: ['-m', 'no', '-t', String(Math.ceil(wakeAt / 1000))] };
}
