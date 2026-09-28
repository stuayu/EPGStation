import { inject, injectable } from 'inversify';
import IEPGUpdateEvent from '../../event/IEPGUpdateEvent';
import IProgramDB from '../../db/IProgramDB';
import IProgramReminderDB from '../../db/IProgramReminderDB';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import INotificationDispatcher from '../../notification/INotificationDispatcher';
import IIPCServer from '../../ipc/IIPCServer';
import ProgramReminder from '../../../db/entities/ProgramReminder';
import IProgramReminderManageModel from './IProgramReminderManageModel';
import ProgramReminderScheduler from './ProgramReminderScheduler';
import { createProgramStartingPayload } from './ProgramReminderPayload';

@injectable()
export default class ProgramReminderManageModel implements IProgramReminderManageModel {
    private readonly log: ILogger;
    private readonly scheduler: ProgramReminderScheduler;
    private refreshing = false;
    private refreshAgain = false;
    private readonly firedIds = new Set<number>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEPGUpdateEvent') private readonly epgUpdateEvent: IEPGUpdateEvent,
        @inject('IProgramReminderDB') private readonly reminderDB: IProgramReminderDB,
        @inject('IProgramDB') private readonly programDB: IProgramDB,
        @inject('INotificationDispatcher') private readonly notification: INotificationDispatcher,
        @inject('IIPCServer') private readonly ipc: IIPCServer,
    ) {
        this.log = logger.getLogger();
        this.scheduler = new ProgramReminderScheduler(
            { setTimeout, clearTimeout },
            reminder => void this.fire(reminder),
        );
    }

    /** EPG 更新と EIT 更新に追従してタイマーを開始する */
    public start(): void {
        this.epgUpdateEvent.setProgramUpdated(() => void this.refresh());
        this.epgUpdateEvent.setOnAirProgramUpdated(() => void this.refresh());
        void this.refresh();
    }

    /** 保存済みリマインダーの番組時刻を再取得してタイマーを張り直す */
    public async refresh(): Promise<void> {
        if (this.refreshing) {
            this.refreshAgain = true;
            return;
        }
        this.refreshing = true;
        do {
            this.refreshAgain = false;
            await this.refreshOnce();
        } while (this.refreshAgain);
        this.refreshing = false;
    }

    private async refreshOnce(): Promise<void> {
        try {
            const reminders = await this.reminderDB.findAll();
            const active: ProgramReminder[] = [];
            const programs = await this.programDB.findIds(reminders.map(reminder => reminder.programId));
            const programById = new Map(programs.map(program => [program.id, program]));
            for (const reminder of reminders) {
                if (this.firedIds.has(reminder.id)) continue;
                if (reminder.startAt <= Date.now()) {
                    await this.reminderDB.delete(reminder.id, reminder.userId);
                    continue;
                }
                const program = programById.get(reminder.programId) ?? null;
                if (program === null || program.startAt <= Date.now()) {
                    await this.reminderDB.delete(reminder.id, reminder.userId);
                    continue;
                }
                const changed =
                    Number(program.startAt) !== reminder.startAt ||
                    program.channelId !== reminder.channelId ||
                    program.name !== reminder.name;
                const updated = Object.assign(reminder, {
                    channelId: program.channelId,
                    name: program.name,
                    startAt: Number(program.startAt),
                });
                if (changed) {
                    await this.reminderDB.update(reminder.id, reminder.userId, {
                        programId: reminder.programId,
                        channelId: updated.channelId,
                        name: updated.name,
                        startAt: updated.startAt,
                    });
                }
                active.push(updated);
            }
            this.scheduler.replaceAll(active);
        } catch (err) {
            this.log.system.error('program reminder refresh error');
            this.log.system.error(err);
        }
    }

    private async fire(reminder: ProgramReminder): Promise<void> {
        if (this.firedIds.has(reminder.id)) return;
        this.firedIds.add(reminder.id);
        try {
            const latest = await this.programDB.findId(reminder.programId);
            if (latest === null || Number(latest.startAt) <= Date.now()) {
                await this.reminderDB.delete(reminder.id, reminder.userId);
                await this.refresh();
                return;
            }
            if (Number(latest.startAt) !== reminder.startAt) {
                await this.refresh();
                return;
            }
            const payload = createProgramStartingPayload(reminder);
            await this.reminderDB.delete(reminder.id, reminder.userId);
            const notificationTargetCount = await this.notification.dispatch('program.starting', { ...payload });
            this.ipc.notifyProgramStartingClient(payload, reminder.userId, notificationTargetCount);
            await this.refresh();
        } catch (err) {
            this.firedIds.delete(reminder.id);
            this.log.system.error('program reminder notification error');
            this.log.system.error(err);
        }
    }
}
