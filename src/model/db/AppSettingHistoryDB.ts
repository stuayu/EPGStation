import { inject, injectable } from 'inversify';
import AppSettingHistory from '../../db/entities/AppSettingHistory';
import IAppSettingHistoryDB from './IAppSettingHistoryDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class AppSettingHistoryDB implements IAppSettingHistoryDB {
    // key ごとに保持する履歴件数の上限。無制限増加を防ぐ
    private static readonly MAX_HISTORY_PER_KEY = 20;

    constructor(@inject('IDBOperator') private readonly op: IDBOperator) {}

    public async add(key: string, previousValue: unknown, now: number): Promise<void> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(AppSettingHistory);
        await repo.save(repo.create({ key, previousValue: JSON.stringify(previousValue ?? null), updatedAt: now }));

        const rows = await repo.find({ where: { key }, order: { id: 'DESC' } });
        const overflow = rows.slice(AppSettingHistoryDB.MAX_HISTORY_PER_KEY);
        if (overflow.length > 0) {
            await repo.delete(overflow.map(r => r.id));
        }
    }

    public async findLatest(key: string): Promise<AppSettingHistory | null> {
        const c = await this.op.getConnection();
        const row = await c.getRepository(AppSettingHistory).findOne({ where: { key }, order: { id: 'DESC' } });
        return row ?? null;
    }

    public async popLatest(key: string): Promise<AppSettingHistory | null> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(AppSettingHistory);
        const row = await repo.findOne({ where: { key }, order: { id: 'DESC' } });
        if (row === null) return null;
        await repo.delete(row.id);
        return row;
    }

    public async list(key: string, limit = AppSettingHistoryDB.MAX_HISTORY_PER_KEY): Promise<AppSettingHistory[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(AppSettingHistory).find({ where: { key }, order: { id: 'DESC' }, take: limit });
    }
}
