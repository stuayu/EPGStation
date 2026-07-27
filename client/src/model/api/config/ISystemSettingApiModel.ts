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
}
