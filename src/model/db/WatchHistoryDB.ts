import { inject, injectable } from 'inversify';
import { In } from 'typeorm';
import WatchHistory from '../../db/entities/WatchHistory';
import IDBOperator from './IDBOperator';
import IWatchHistoryDB, { UpsertWatchHistoryOption } from './IWatchHistoryDB';
@injectable()
export default class WatchHistoryDB implements IWatchHistoryDB {
    constructor(@inject('IDBOperator') private readonly op: IDBOperator) {}
    public async findByVideoFileId(videoFileId: number): Promise<WatchHistory | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(WatchHistory).findOne({ where: { videoFileId } });
    }
    public async upsert(o: UpsertWatchHistoryOption): Promise<WatchHistory> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(WatchHistory);
        const current = await repo.findOne({ where: { videoFileId: o.videoFileId } });
        return await repo.save(repo.create({ ...current, ...o, userId: current?.userId ?? null }));
    }
    public async findByVideoFileIds(ids: number[]): Promise<WatchHistory[]> {
        if (ids.length === 0) return [];
        const c = await this.op.getConnection();
        return await c.getRepository(WatchHistory).find({ where: { videoFileId: In(ids) } });
    }

    public async deleteByVideoFileId(videoFileId: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(WatchHistory).delete({ videoFileId });
    }
}
