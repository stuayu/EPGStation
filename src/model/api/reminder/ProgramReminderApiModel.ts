import { inject, injectable } from 'inversify';
import IProgramDB from '../../db/IProgramDB';
import IProgramReminderDB from '../../db/IProgramReminderDB';
import ProgramReminder from '../../../db/entities/ProgramReminder';
import IProgramReminderApiModel from './IProgramReminderApiModel';
import IIPCClient from '../../ipc/IIPCClient';

@injectable()
export default class ProgramReminderApiModel implements IProgramReminderApiModel {
    constructor(
        @inject('IProgramReminderDB') private readonly reminderDB: IProgramReminderDB,
        @inject('IProgramDB') private readonly programDB: IProgramDB,
        @inject('IIPCClient') private readonly ipc: IIPCClient,
    ) {}

    public gets(userId: number | null): Promise<ProgramReminder[]> {
        return this.reminderDB.findAll(userId);
    }

    public async get(programId: number, userId: number | null): Promise<ProgramReminder | null> {
        return (await this.reminderDB.findByProgramId(programId, userId))[0] ?? null;
    }

    public async create(programId: number, minutesBefore: number, userId: number | null): Promise<ProgramReminder> {
        if (
            !Number.isInteger(programId) ||
            programId <= 0 ||
            !Number.isInteger(minutesBefore) ||
            minutesBefore < 1 ||
            minutesBefore > 1440
        ) {
            throw new Error('InvalidRequestBody');
        }
        const program = await this.programDB.findId(programId);
        if (program === null || Number(program.startAt) <= Date.now())
            throw new Error('ProgramReminderProgramIsNotFound');
        const existing = await this.get(programId, userId);
        if (existing !== null) return existing;
        const reminder = await this.reminderDB.insert({
            programId,
            channelId: program.channelId,
            name: program.name,
            startAt: Number(program.startAt),
            minutesBefore,
            userId,
            createdAt: Date.now(),
        });
        await this.ipc.reminder.refresh();
        return reminder;
    }

    public async delete(id: number, userId: number | null): Promise<void> {
        if (!Number.isInteger(id) || id <= 0) throw new Error('InvalidRequestBody');
        await this.reminderDB.delete(id, userId);
        await this.ipc.reminder.refresh();
    }
}
