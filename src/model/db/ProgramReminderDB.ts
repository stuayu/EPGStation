import { inject, injectable } from 'inversify';
import { IsNull } from 'typeorm';
import ProgramReminder from '../../db/entities/ProgramReminder';
import IProgramReminderDB, { NewProgramReminder, UpdateProgramReminder } from './IProgramReminderDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class ProgramReminderDB implements IProgramReminderDB {
    constructor(@inject('IDBOperator') private readonly op: IDBOperator) {}

    public async findAll(userId?: number | null): Promise<ProgramReminder[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(ProgramReminder).find({
            ...(typeof userId === 'undefined' ? {} : { where: { userId: userId === null ? IsNull() : userId } }),
            order: { startAt: 'ASC' },
        });
    }

    public async findByProgramId(programId: number, userId: number | null): Promise<ProgramReminder[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(ProgramReminder).find({
            where: { programId, userId: userId === null ? IsNull() : userId },
            order: { createdAt: 'ASC' },
        });
    }

    public async findById(id: number): Promise<ProgramReminder | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(ProgramReminder).findOne({ where: { id } });
    }

    public async insert(value: NewProgramReminder): Promise<ProgramReminder> {
        const c = await this.op.getConnection();
        const repository = c.getRepository(ProgramReminder);
        return await repository.save(repository.create(value));
    }

    public async update(id: number, userId: number | null, value: UpdateProgramReminder): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(ProgramReminder).update({ id, userId: userId === null ? IsNull() : userId }, value);
    }

    public async delete(id: number, userId: number | null): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(ProgramReminder).delete({ id, userId: userId === null ? IsNull() : userId });
    }
}
