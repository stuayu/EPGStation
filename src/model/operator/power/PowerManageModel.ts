import { inject, injectable } from 'inversify';
import IReserveDB from '../../db/IReserveDB';
import IRecordingEvent from '../../event/IRecordingEvent';
import IReserveEvent from '../../event/IReserveEvent';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import INotificationDispatcher from '../../notification/INotificationDispatcher';
import IIPCServer from '../../ipc/IIPCServer';
import IRecordingManageModel from '../recording/IRecordingManageModel';
import IPowerManageModel from './IPowerManageModel';
import { buildPowerCommand, buildRtcWakeCommand, decidePowerAction } from '../../power/PowerPolicy';
import IPowerCommandExecutor from '../../power/IPowerCommandExecutor';
import IImportJobManageModel from '../recorded/IImportJobManageModel';
import IThumbnailManageModel from '../thumbnail/IThumbnailManageModel';
import IEPGUpdateExecutorManageModel from '../../epgUpdater/IEPGUpdateExecutorManageModel';
import { resolveRecordingTimingConfig } from '../recording/RecordingTimingConfig';

@injectable()
export default class PowerManageModel implements IPowerManageModel {
    private readonly log: ILogger;
    private timer: NodeJS.Timeout | null = null;
    private suspendTimer: NodeJS.Timeout | null = null;
    private idleSinceAt = Date.now();
    private canceledUntilBusy = false;
    private lastWakeSignature = '';
    private running = false;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IReserveDB') private readonly reserveDB: IReserveDB,
        @inject('IRecordingManageModel') private readonly recordingManage: IRecordingManageModel,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
        @inject('IReserveEvent') reserveEvent: IReserveEvent,
        @inject('IIPCServer') private readonly ipc: IIPCServer,
        @inject('INotificationDispatcher') private readonly notification: INotificationDispatcher,
        @inject('IPowerCommandExecutor') private readonly commandExecutor: IPowerCommandExecutor,
        @inject('IImportJobManageModel') private readonly importJobs: IImportJobManageModel,
        @inject('IThumbnailManageModel') private readonly thumbnailManage: IThumbnailManageModel,
        @inject('IEPGUpdateExecutorManageModel') private readonly epgUpdater: IEPGUpdateExecutorManageModel,
    ) {
        this.log = logger.getLogger();
        recordingEvent.setFinishRecording(() => this.evaluate());
        recordingEvent.setStartPrepRecording(() => this.evaluate());
        recordingEvent.setStartRecording(() => this.evaluate());
        recordingEvent.setCancelPrepRecording(() => this.evaluate());
        recordingEvent.setPrepRecordingFailed(() => this.evaluate());
        recordingEvent.setRecordingFailed(() => this.evaluate());
        reserveEvent.setUpdated(() => {
            void this.evaluate();
        });
    }

    /** 録画・予約イベントと定期確認を開始する */
    public start(): void {
        if (this.running) return;
        this.running = true;
        this.timer = setInterval(() => this.evaluate(), 5_000);
        this.timer.unref?.();
        void this.evaluate();
    }

    /** 予定している休止を取り消し、次の idle 遷移まで抑止する */
    public cancel(): void {
        this.canceledUntilBusy = true;
        if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
        this.suspendTimer = null;
    }

    private getConfig() {
        const value = this.configuration.getConfig().power ?? {};
        return {
            enabled: value.enabled === true,
            afterRecording: value.afterRecording ?? 'none',
            idleMinutes: value.idleMinutes ?? 10,
            minGapMinutes: value.minGapMinutes ?? 30,
            wakeBeforeSec: value.wakeBeforeSec ?? 300,
            commands: value.commands,
        };
    }

    private async getNextReservationAt(): Promise<number | null> {
        const reserve = await this.reserveDB.findNextUpcomingForPower(Date.now());
        if (reserve === null) return null;
        const recording = this.configuration.getConfig().recording;
        const timing = resolveRecordingTimingConfig(
            recording,
            this.configuration.getConfig().timeSpecifiedStartMargin ?? 0,
            this.configuration.getConfig().timeSpecifiedEndMargin ?? 0,
            reserve,
        );
        return reserve.startAt - timing.startMarginMs - timing.prepMs;
    }

    private async refreshWakeTimer(nextAt?: number | null): Promise<boolean> {
        const config = this.getConfig();
        if (config.enabled !== true || config.afterRecording === 'none') {
            if (this.lastWakeSignature !== '') await this.clearWakeTimer();
            this.lastWakeSignature = '';
            return true;
        }
        if (typeof nextAt === 'undefined') {
            try {
                nextAt = await this.getNextReservationAt();
            } catch (err) {
                this.log.system.warn(err);
                return false;
            }
        }
        const wakeAt = nextAt === null ? null : nextAt - config.wakeBeforeSec * 1000;
        const signature = wakeAt === null ? '' : String(wakeAt);
        if (signature === this.lastWakeSignature) return true;
        const hadWakeTimer = this.lastWakeSignature !== '';
        this.lastWakeSignature = signature;
        if (wakeAt === null) {
            if (hadWakeTimer) await this.clearWakeTimer();
            return true;
        }
        const now = Date.now();
        if (wakeAt <= now) {
            if (hadWakeTimer) await this.clearWakeTimer();
            return nextAt === null;
        }
        try {
            if (process.platform === 'win32') {
                const at = new Date(wakeAt).toISOString();
                const ps =
                    `$a=New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'; ` +
                    `$t=New-ScheduledTaskTrigger -Once -At '${at}'; ` +
                    `Register-ScheduledTask -TaskName 'EPGStationWake' -Action $a -Trigger $t ` +
                    '-Settings (New-ScheduledTaskSettingsSet -WakeToRun) -Force';
                const custom = config.commands?.windows?.wake
                    ?.replaceAll('%WAKE_AT%', at)
                    .replaceAll('%WAKE_AT_UNIX%', String(Math.ceil(wakeAt / 1000)));
                if (custom)
                    await this.commandExecutor.run('powershell.exe', [
                        '-NoProfile',
                        '-NonInteractive',
                        '-Command',
                        custom,
                    ]);
                else
                    await this.commandExecutor.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
            } else {
                const custom = config.commands?.linux?.wake
                    ?.replaceAll('%WAKE_AT%', new Date(wakeAt).toISOString())
                    .replaceAll('%WAKE_AT_UNIX%', String(Math.ceil(wakeAt / 1000)));
                if (custom) await this.commandExecutor.run('/bin/sh', ['-c', custom]);
                else {
                    const cmd = buildRtcWakeCommand(wakeAt);
                    await this.commandExecutor.run(cmd.command, cmd.args);
                }
            }
        } catch (err) {
            this.log.system.warn(`failed to register wake timer: ${String(err)}`);
            this.lastWakeSignature = '';
            return false;
        }
        return true;
    }

    private async clearWakeTimer(): Promise<void> {
        try {
            if (process.platform === 'win32') {
                await this.commandExecutor.run('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    "Unregister-ScheduledTask -TaskName 'EPGStationWake' -Confirm:$false -ErrorAction SilentlyContinue",
                ]);
            } else {
                await this.commandExecutor.run('rtcwake', ['-m', 'disable']);
            }
        } catch (err) {
            this.log.system.warn(`failed to clear wake timer: ${String(err)}`);
        }
    }

    private async evaluate(): Promise<void> {
        if (this.running === false) return;
        const config = this.getConfig();
        const service = this.ipc.getPowerActivity();
        const counts = this.recordingManage.getPowerCounts();
        const now = Date.now();
        let nextReservationAt: number | null;
        try {
            nextReservationAt = await this.getNextReservationAt();
        } catch (err) {
            this.log.system.warn(err);
            return;
        }
        const wakeReady = await this.refreshWakeTimer(nextReservationAt);
        const busy =
            now - service.updatedAt > 30_000 ||
            counts.recordingCount +
                counts.recordingPreparationCount +
                service.encodeRunningCount +
                service.encodeWaitingCount +
                service.liveStreamCount +
                service.recordedStreamCount >
                0;
        if (busy) {
            this.idleSinceAt = now;
            this.canceledUntilBusy = false;
            if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
            this.suspendTimer = null;
            return;
        }
        const decision = decidePowerAction(
            config,
            {
                idleSinceAt: this.idleSinceAt,
                ...counts,
                encodeRunningCount: service.encodeRunningCount,
                encodeWaitingCount: service.encodeWaitingCount,
                liveStreamCount: service.liveStreamCount,
                recordedStreamCount: service.recordedStreamCount,
                heavyTaskRunning:
                    this.importJobs.hasRunningJobs() || this.thumbnailManage.isBusy() || this.epgUpdater.isBusy(),
                nextReservationAt,
            },
            now,
        );
        if (!decision.shouldSuspend || this.canceledUntilBusy || wakeReady === false) {
            if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
            this.suspendTimer = null;
            return;
        }
        if (this.suspendTimer !== null) return;
        this.ipc.notifyPowerSuspending({ action: config.afterRecording, executeAt: now + 60_000 });
        void this.notification
            .dispatch('power.suspending', { action: config.afterRecording, executeAt: now + 60_000 })
            .catch(err => this.log.system.warn(`power notification failed: ${String(err)}`));
        this.suspendTimer = setTimeout(() => {
            this.suspendTimer = null;
            void this.suspend(config.afterRecording);
        }, 60_000);
        this.suspendTimer.unref?.();
    }

    private async suspend(action: 'none' | 'standby' | 'hibernate' | 'shutdown'): Promise<void> {
        const config = this.getConfig();
        if (this.canceledUntilBusy || action === 'none') return;
        let nextReservationAt: number | null;
        try {
            nextReservationAt = await this.getNextReservationAt();
        } catch (err) {
            this.log.system.warn(err);
            return;
        }
        if ((await this.refreshWakeTimer(nextReservationAt)) === false) return;
        // ウェイク登録の待ち時間中に予約が変わっていないか確認する。
        try {
            const latestReservationAt = await this.getNextReservationAt();
            if (latestReservationAt !== nextReservationAt) {
                nextReservationAt = latestReservationAt;
                if ((await this.refreshWakeTimer(nextReservationAt)) === false) return;
            }
        } catch (err) {
            this.log.system.warn(err);
            return;
        }
        const service = this.ipc.getPowerActivity();
        const counts = this.recordingManage.getPowerCounts();
        const now = Date.now();
        const decision = decidePowerAction(
            config,
            {
                idleSinceAt: this.idleSinceAt,
                ...counts,
                encodeRunningCount: service.encodeRunningCount,
                encodeWaitingCount: service.encodeWaitingCount,
                liveStreamCount: service.liveStreamCount,
                recordedStreamCount: service.recordedStreamCount,
                heavyTaskRunning:
                    this.importJobs.hasRunningJobs() || this.thumbnailManage.isBusy() || this.epgUpdater.isBusy(),
                nextReservationAt,
            },
            now,
        );
        if (this.canceledUntilBusy || !decision.shouldSuspend || now - service.updatedAt > 30_000) return;
        try {
            const commands = config.commands;
            const custom = process.platform === 'win32' ? commands?.windows?.[action] : commands?.linux?.[action];
            if (custom)
                await this.commandExecutor.run(
                    process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
                    process.platform === 'win32' ? ['/c', custom] : ['-c', custom],
                );
            else {
                const command = buildPowerCommand(process.platform, action);
                if (command !== null) await this.commandExecutor.run(command.command, command.args);
            }
        } catch (err) {
            this.log.system.warn(`failed to enter power state: ${String(err)}`);
        }
        this.idleSinceAt = Date.now();
    }
}
