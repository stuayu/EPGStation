import { inject, injectable } from 'inversify';
import AppSetting from '../../db/entities/AppSetting';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IDBOperator from './IDBOperator';
import IAppSettingDB from './IAppSettingDB';
@injectable()
export default class AppSettingDB implements IAppSettingDB {
    private log: ILogger;
    constructor(
        @inject('IDBOperator') private op: IDBOperator,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.log = logger.getLogger();
    }
    async getAll() {
        const c = await this.op.getConnection();
        const rows = await c.getRepository(AppSetting).find();
        const result: Record<string, unknown> = {};
        for (const row of rows) {
            try {
                result[row.key] = JSON.parse(row.value);
            } catch (err) {
                // 値が壊れている行があっても getAll() 全体を落とさない (設定画面・ダッシュボード・
                // 通知が軒並み動かなくなるのを防ぐ)。壊れた行はログに残しつつ無視する
                this.log.system.error(`AppSettingDB: failed to parse value for key "${row.key}"`);
                this.log.system.error(err);
            }
        }
        return result;
    }
    async upsert(values: Record<string, unknown>) {
        const c = await this.op.getConnection();
        const repo = c.getRepository(AppSetting);
        for (const [key, value] of Object.entries(values))
            await repo.save(repo.create({ key, value: JSON.stringify(value), updatedAt: Date.now() }));
    }
}
