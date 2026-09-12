import { inject, injectable } from 'inversify';
import { In } from 'typeorm';
import WatchHistory from '../../db/entities/WatchHistory';
import IDBOperator from './IDBOperator';
import IWatchHistoryDB, { FindWatchHistoryOption, UpsertWatchHistoryOption } from './IWatchHistoryDB';
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
            // 挿入後に生成列を読み戻す既定動作 (updateEntity) を切る。ON CONFLICT で既存行の更新に
            // なった場合は挿入 id が無く、TypeORM が "Cannot update entity because entity id is not set
            // in the entity." で失敗して PUT が 500 になる (再生位置が一切保存されなかった)。
            // 戻り値は直後の findByVideoFileId() で読み直すので読み戻しは不要
            .updateEntity(false)
            .execute();
        return (await this.findByVideoFileId(o.videoFileId))!;
    }
    public async findByVideoFileIds(ids: number[]): Promise<WatchHistory[]> {
        if (ids.length === 0) return [];
        const c = await this.op.getConnection();
        return await c.getRepository(WatchHistory).find({ where: { videoFileId: In(ids) } });
    }

    /**
     * 最後に視聴した順で視聴履歴を取得する
     * @param option: FindWatchHistoryOption
     * @return Promise<[WatchHistory[], number]> 履歴と総件数
     */
    public async findRecent(option: FindWatchHistoryOption): Promise<[WatchHistory[], number]> {
        const c = await this.op.getConnection();
        const queryBuilder = c
            .getRepository(WatchHistory)
            .createQueryBuilder('watch_history')
            .orderBy('watch_history.updatedAt', 'DESC')
            .offset(option.offset)
            .limit(option.limit);

        if (typeof option.status !== 'undefined') {
            queryBuilder.where('watch_history.status = :status', { status: option.status });
        }

        return await queryBuilder.getManyAndCount();
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
