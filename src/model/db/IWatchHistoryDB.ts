import WatchHistory from '../../db/entities/WatchHistory';
export interface UpsertWatchHistoryOption {
    videoFileId: number;
    recordedId: number;
    position: number;
    duration: number;
    status: WatchHistory['status'];
    updatedAt: number;
}
export default interface IWatchHistoryDB {
    findByVideoFileId(id: number): Promise<WatchHistory | null>;
    upsert(o: UpsertWatchHistoryOption): Promise<WatchHistory>;
    deleteByVideoFileId(id: number): Promise<void>;
}
