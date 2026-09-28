import ProgramReminder from '../../../db/entities/ProgramReminder';

export default interface IProgramReminderApiModel {
    gets(userId: number | null): Promise<ProgramReminder[]>;
    get(programId: number, userId: number | null): Promise<ProgramReminder | null>;
    create(programId: number, minutesBefore: number, userId: number | null): Promise<ProgramReminder>;
    delete(id: number, userId: number | null): Promise<void>;
}
