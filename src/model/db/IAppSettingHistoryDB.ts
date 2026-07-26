import AppSettingHistory from '../../db/entities/AppSettingHistory';
export default interface IAppSettingHistoryDB {
    /**
     * key の変更前の値を履歴として追加する。key ごとの保持件数上限を超えた古い履歴は削除する
     */
    add(key: string, previousValue: unknown, now: number): Promise<void>;
    /**
     * key の直近の履歴 (削除はしない)
     */
    findLatest(key: string): Promise<AppSettingHistory | null>;
    /**
     * key の直近の履歴を取得しつつ削除する (ロールバック適用用、1 回限りの undo)
     */
    popLatest(key: string): Promise<AppSettingHistory | null>;
    list(key: string, limit?: number): Promise<AppSettingHistory[]>;
}
