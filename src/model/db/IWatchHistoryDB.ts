import WatchHistory from '../../db/entities/WatchHistory';
export interface UpsertWatchHistoryOption {
    videoFileId: number;
    recordedId: number;
    position: number;
    duration: number;
    status: WatchHistory['status'];
    updatedAt: number;
}
/**
 * 視聴履歴一覧の取得条件
 */
export interface FindWatchHistoryOption {
    limit: number;
    offset: number;
    // 指定すると視聴状態で絞り込む
    status?: WatchHistory['status'];
}

export default interface IWatchHistoryDB {
    findByVideoFileId(id: number): Promise<WatchHistory | null>;
    upsert(o: UpsertWatchHistoryOption): Promise<WatchHistory>;
    findByVideoFileIds(ids: number[]): Promise<WatchHistory[]>;
    /**
     * 最後に視聴した順で視聴履歴を取得する
     * @param option: FindWatchHistoryOption
     * @return Promise<[WatchHistory[], number]> 履歴と総件数
     */
    findRecent(option: FindWatchHistoryOption): Promise<[WatchHistory[], number]>;
    deleteByVideoFileId(id: number): Promise<void>;
    deleteByRecordedId(recordedId: number): Promise<void>;
}
