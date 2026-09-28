import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import IReminderApiModel, { ProgramReminder } from './IReminderApiModel';

@injectable()
export default class ReminderApiModel implements IReminderApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    public async getAll(): Promise<ProgramReminder[]> {
        const result = await this.repository.get('/reminders');
        return result.data.reminders;
    }

    public async getByProgramId(programId: number): Promise<ProgramReminder | null> {
        const result = await this.repository.get(`/reminders/program/${programId}`);
        return result.data.reminder;
    }

    public async add(programId: number, minutesBefore: number): Promise<ProgramReminder> {
        const result = await this.repository.post('/reminders', { programId, minutesBefore });
        return result.data.reminder;
    }

    public async remove(id: number): Promise<void> {
        await this.repository.delete(`/reminders/${id}`);
    }
}
