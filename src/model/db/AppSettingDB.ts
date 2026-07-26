import { inject, injectable } from 'inversify';
import AppSetting from '../../db/entities/AppSetting';
import IDBOperator from './IDBOperator';
import IAppSettingDB from './IAppSettingDB';
@injectable()
export default class AppSettingDB implements IAppSettingDB {
    constructor(@inject('IDBOperator') private op: IDBOperator) {}
    async getAll() {
        const c = await this.op.getConnection();
        const rows = await c.getRepository(AppSetting).find();
        return Object.fromEntries(rows.map(x => [x.key, JSON.parse(x.value)]));
    }
    async upsert(values: Record<string, unknown>) {
        const c = await this.op.getConnection();
        const repo = c.getRepository(AppSetting);
        for (const [key, value] of Object.entries(values))
            await repo.save(repo.create({ key, value: JSON.stringify(value), updatedAt: Date.now() }));
    }
}
