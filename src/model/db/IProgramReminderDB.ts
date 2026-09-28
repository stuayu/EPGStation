import ProgramReminder from '../../db/entities/ProgramReminder';

export interface NewProgramReminder {
    programId: number;
    channelId: number;
    name: string;
    startAt: number;
    minutesBefore: number;
    userId: number | null;
    createdAt: number;
}

export interface UpdateProgramReminder {
    programId: number;
    channelId: number;
    name: string;
    startAt: number;
}

export default interface IProgramReminderDB {
    findAll(userId?: number | null): Promise<ProgramReminder[]>;
    findByProgramId(programId: number, userId: number | null): Promise<ProgramReminder[]>;
    findById(id: number): Promise<ProgramReminder | null>;
    insert(value: NewProgramReminder): Promise<ProgramReminder>;
    update(id: number, userId: number | null, value: UpdateProgramReminder): Promise<void>;
    delete(id: number, userId: number | null): Promise<void>;
}
