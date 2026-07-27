import * as apid from '../../../../../api';

export default interface ISystemSettingApiModel {
    get(): Promise<apid.AppSettingValue>;
    update(value: Record<string, any>): Promise<apid.AppSettingUpdateResult>;
    testNotification(targetName?: string): Promise<apid.NotificationTestResult>;
    /**
     * 指定したトップレベルキーの変更履歴一覧 (新しい順) を取得する
     * @param key: トップレベルキー (metadata / notifications / series / dashboard)
     */
    getHistory(key: string): Promise<apid.AppSettingHistoryItem[]>;
    /**
     * 指定したトップレベルキーを直前の状態へロールバックする (1 回限りの undo)
     * @param key: トップレベルキー
     */
    rollback(key: string): Promise<apid.AppSettingUpdateResult>;
    /**
     * リトライ上限に達し送信を断念した通知の履歴を取得する
     * @param limit: 取得件数上限
     */
    getNotificationFailures(limit?: number): Promise<apid.NotificationFailureHistoryItem[]>;
    /**
     * Annict への接続テスト (viewer クエリでの疎通・トークンの有効性確認)
     */
    testAnnictConnection(): Promise<apid.AnnictConnectionTestResult>;
    /**
     * しょぼいカレンダー チャンネルマッピング表 (設定画面 (DB) からの登録分) を取得する
     */
    getSyobocalChannelMap(): Promise<apid.SyobocalChannelMapEntry[]>;
    /**
     * しょぼいカレンダー チャンネルマッピング表を全件置き換えで更新する
     */
    updateSyobocalChannelMap(entries: apid.SyobocalChannelMapEntry[]): Promise<apid.SyobocalChannelMapEntry[]>;
    /**
     * 共有静的データ (チャンネルマッピング表・エイリアス辞書) を今すぐ同期する
     */
    syncSharedData(): Promise<apid.SharedDataSyncResult>;
}
