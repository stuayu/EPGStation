import AnnictWatchSync from '../../db/entities/AnnictWatchSync';
export interface NewAnnictWatchSync {
    recordedId: number;
    seriesId: number;
    seriesEpisodeId: number;
    annictWorkId: string;
    episodeNumber: number;
    now: number;
}
export interface MarkFailedOption {
    attempts: number;
    nextAttemptAt: number;
    lastError: string;
    terminal: boolean;
}
export default interface IAnnictWatchSyncDB {
    /**
     * (seriesId, seriesEpisodeId) で一意に既存行を探し、無ければ pending として新規作成する。
     * 既に status: 'sent' の行があれば何もしない (二重送信防止)。
     * 'pending' / 'failed' の行がある場合は次回即時リトライされるよう nextAttemptAt を現在時刻に更新する
     */
    enqueue(value: NewAnnictWatchSync): Promise<AnnictWatchSync | null>;
    findDue(now: number, limit: number): Promise<AnnictWatchSync[]>;
    markSent(id: number, now: number): Promise<void>;
    markFailed(id: number, option: MarkFailedOption): Promise<void>;
    findBySeriesId(seriesId: number): Promise<AnnictWatchSync[]>;
}
