import ProgramReminder from '../../../db/entities/ProgramReminder';

export interface ProgramStartingPayload {
    programId: number;
    channelId: number;
    name: string;
    startAt: number;
    minutesBefore: number;
}

/** 通知の送信先で共有する番組開始 payload を作る */
export const createProgramStartingPayload = (reminder: ProgramReminder): ProgramStartingPayload => ({
    programId: reminder.programId,
    channelId: reminder.channelId,
    name: reminder.name,
    startAt: reminder.startAt,
    minutesBefore: reminder.minutesBefore,
});
