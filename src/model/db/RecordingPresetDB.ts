import { inject, injectable } from 'inversify';
import RecordingPreset from '../../db/entities/RecordingPreset';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IRecordingPresetDB from './IRecordingPresetDB';

@injectable()
export default class RecordingPresetDB implements IRecordingPresetDB {
    constructor(
        @inject('IDBOperator') private op: IDBOperator,
        @inject('IPromiseRetry') private retry: IPromiseRetry,
    ) {}

    public async findAll(): Promise<RecordingPreset[]> {
        const c = await this.op.getConnection();
        return await this.retry.run(() =>
            c.getRepository(RecordingPreset).find({ order: { updatedAt: 'DESC', id: 'ASC' } }),
        );
    }

    public async findId(id: number): Promise<RecordingPreset | null> {
        const c = await this.op.getConnection();
        return (await this.retry.run(() => c.getRepository(RecordingPreset).findOneBy({ id }))) ?? null;
    }

    public async findDefault(): Promise<RecordingPreset | null> {
        const c = await this.op.getConnection();
        return (
            (await this.retry.run(() =>
                c.getRepository(RecordingPreset).findOne({ where: { isDefault: true }, order: { id: 'ASC' } }),
            )) ?? null
        );
    }

    public async insert(item: RecordingPreset): Promise<number> {
        const c = await this.op.getConnection();
        return (await this.retry.run(() => c.getRepository(RecordingPreset).save(item))).id;
    }

    public async update(item: RecordingPreset): Promise<void> {
        const c = await this.op.getConnection();
        await this.retry.run(() => c.getRepository(RecordingPreset).save(item));
    }

    public async delete(id: number): Promise<void> {
        const c = await this.op.getConnection();
        await this.retry.run(() => c.createQueryBuilder().delete().from(RecordingPreset).where({ id }).execute());
    }
}
