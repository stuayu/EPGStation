export interface ProgramReminder {
    id: number;
    programId: number;
    channelId: number;
    name: string;
    startAt: number;
    minutesBefore: number;
    userId: number | null;
    createdAt: number;
}

export default interface IReminderApiModel {
    getAll(): Promise<ProgramReminder[]>;
    getByProgramId(programId: number): Promise<ProgramReminder | null>;
    add(programId: number, minutesBefore: number): Promise<ProgramReminder>;
    remove(id: number): Promise<void>;
}
