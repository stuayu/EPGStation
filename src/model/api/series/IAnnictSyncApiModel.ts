export interface AnnictSyncResult {
    seriesId: number;
    annictId: string;
    syobocalTid: number | null;
    title: string;
    score: number;
}
export default interface IAnnictSyncApiModel {
    sync(seriesId: number): Promise<AnnictSyncResult>;
    /**
     * 指定シリーズの視聴記録を Annict へ手動再同期する (キューへ再投入し、即座に処理を試みる)
     */
    syncWatchRecords(seriesId: number): Promise<{ queued: number }>;
}
