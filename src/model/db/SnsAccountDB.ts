import { inject, injectable } from 'inversify';
import { IsNull } from 'typeorm';
import SnsAccount, { SnsAccountProvider } from '../../db/entities/SnsAccount';
import IDBOperator from './IDBOperator';
import ISnsAccountDB from './ISnsAccountDB';

@injectable()
export default class SnsAccountDB implements ISnsAccountDB {
    constructor(@inject('IDBOperator') private readonly op: IDBOperator) {}

    public async insertOnce(account: SnsAccount): Promise<number> {
        const c = await this.op.getConnection();
        const inserted = await c.getRepository(SnsAccount).save(account);

        return inserted.id;
    }

    public async update(account: SnsAccount): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(SnsAccount).save(account);
    }

    public async delete(id: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(SnsAccount).delete({ id });
    }

    public async findById(id: number): Promise<SnsAccount | null> {
        const c = await this.op.getConnection();

        return await c.getRepository(SnsAccount).findOne({ where: { id } });
    }

    public async findByUser(userId: number | null): Promise<SnsAccount[]> {
        const c = await this.op.getConnection();

        return await c
            .getRepository(SnsAccount)
            .find({ where: { userId: userId === null ? IsNull() : userId }, order: { id: 'ASC' } });
    }

    public async findDuplicate(
        provider: SnsAccountProvider,
        userId: number | null,
        remoteUserId: string,
        instanceUrl: string | null,
    ): Promise<SnsAccount | null> {
        const c = await this.op.getConnection();

        return await c.getRepository(SnsAccount).findOne({
            where: {
                provider,
                userId: userId === null ? IsNull() : userId,
                remoteUserId,
                instanceUrl: instanceUrl === null ? IsNull() : instanceUrl,
            },
        });
    }
}
