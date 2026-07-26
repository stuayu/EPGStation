export interface AppSettingUpdateResult {
    // マスク・復号適用済みの設定値一式
    settings: Record<string, unknown>;
    // 今回の更新に、Operator の再初期化を要するキーが含まれていたか
    requiresRestart: boolean;
    // 再起動を要すると判定されたキーの一覧 (画面表示用)
    requiresRestartKeys: string[];
}

export interface AppSettingHistoryItem {
    id: number;
    key: string;
    updatedAt: number;
}

export default interface IAppSettingApiModel {
    get(): Promise<Record<string, unknown>>;
    update(values: Record<string, unknown>): Promise<AppSettingUpdateResult>;
    /**
     * 指定した key の変更履歴一覧 (新しい順)。前の値そのものは含まず件数と時刻のみを返す
     */
    getHistory(key: string): Promise<AppSettingHistoryItem[]>;
    /**
     * 指定した key を直前の状態へロールバックする (1 回限りの undo)
     */
    rollback(key: string): Promise<AppSettingUpdateResult>;
}
