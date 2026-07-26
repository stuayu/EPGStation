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
        // find → save の read-modify-write だと UNIQUE 制約 (videoFileId) を持つ行への
        // 同時 PUT でレースが発生し 500 になるため、DB の upsert (ON CONFLICT / ON DUPLICATE KEY) で
        // 原子的に行う。userId は overwrite 対象から外し、既存行の値を保持する (新規行では null)
        await c
            .createQueryBuilder()
            .insert()
            .into(WatchHistory)
            .values({
                videoFileId: o.videoFileId,
                recordedId: o.recordedId,
                userId: null,
                position: o.position,
                duration: o.duration,
                status: o.status,
                updatedAt: o.updatedAt,
            })
            .orUpdate(['recordedId', 'position', 'duration', 'status', 'updatedAt'], ['videoFileId'])
            .execute();
        return (await this.findByVideoFileId(o.videoFileId))!;
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

    public async deleteByRecordedId(recordedId: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(WatchHistory).delete({ recordedId });
    }
}
