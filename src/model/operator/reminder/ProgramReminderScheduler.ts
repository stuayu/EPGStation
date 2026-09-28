import ProgramReminder from '../../../db/entities/ProgramReminder';

export interface ProgramReminderTimerHost {
    setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
    clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

/** 番組リマインダーのタイマーを差し替え可能な形で管理する */
export default class ProgramReminderScheduler {
    private timers = new Map<number, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly host: ProgramReminderTimerHost,
        private readonly fire: (reminder: ProgramReminder) => void,
        private readonly now: () => number = Date.now,
    ) {}

    /** 登録済みタイマーを解除し、現在の時刻で全件張り直す */
    public replaceAll(reminders: ProgramReminder[]): void {
        this.clear();
        for (const reminder of reminders) {
            const fireAt = reminder.startAt - reminder.minutesBefore * 60_000;
            if (reminder.startAt <= this.now()) continue;
            this.schedule(reminder, fireAt);
        }
    }

    /** 指定リマインダーのタイマーを張る */
    public schedule(reminder: ProgramReminder, fireAt: number): void {
        this.cancel(reminder.id);
        if (reminder.startAt <= this.now()) return;
        const delay = Math.max(0, Math.min(fireAt - this.now(), 2_147_000_000));
        const timer = this.host.setTimeout(() => {
            this.timers.delete(reminder.id);
            if (fireAt > this.now()) this.schedule(reminder, fireAt);
            else if (reminder.startAt > this.now()) this.fire(reminder);
        }, delay);
        this.timers.set(reminder.id, timer);
    }

    /** 指定リマインダーのタイマーを解除する */
    public cancel(id: number): void {
        const timer = this.timers.get(id);
        if (timer !== undefined) this.host.clearTimeout(timer);
        this.timers.delete(id);
    }

    /** 全タイマーを解除する */
    public clear(): void {
        for (const timer of this.timers.values()) this.host.clearTimeout(timer);
        this.timers.clear();
    }
}
