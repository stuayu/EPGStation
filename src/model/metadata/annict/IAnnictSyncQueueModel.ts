export interface AnnictSyncQueueProcessResult {
    processed: number;
    sent: number;
    failed: number;
}
export default interface IAnnictSyncQueueModel {
    /**
     * WatchHistory が watched へ遷移した録画をトリガーに、Annict への視聴記録同期をキューへ積む。
     * 機能フラグ (annictSync) が無効な場合は何もしない。失敗しても呼び出し元 (視聴履歴更新) には
     * 影響させないため、内部で例外を握りつぶす (fire-and-forget)
     */
    enqueueFromWatchHistory(recordedId: number): void;
    /**
     * 指定シリーズの録画 (話数確定済みのもの全て) を手動同期用にキューへ積み直す。
     * 機能フラグが無効な場合は例外を投げる
     */
    enqueueSeries(seriesId: number): Promise<{ queued: number }>;
    /**
     * キューを処理する (通常はバックグラウンドタイマーが呼ぶ。手動同期 API・テストからも呼び出し可能)
     */
    processQueue(limit?: number): Promise<AnnictSyncQueueProcessResult>;
}
