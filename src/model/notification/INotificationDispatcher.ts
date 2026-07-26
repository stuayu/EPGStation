import { NotificationEventType } from '../IConfigFile';
export interface NotificationEvent {
    id: string;
    type: NotificationEventType;
    occurredAt: number;
    payload: Record<string, unknown>;
}
export interface NotificationFailureHistoryItem {
    id: number;
    targetName: string;
    eventType: NotificationEventType;
    attempts: number;
    lastError: string | null;
    updatedAt: number;
}
export default interface INotificationDispatcher {
    dispatch(type: NotificationEventType, payload: Record<string, unknown>): Promise<void>;
    test(targetName?: string): Promise<{ delivered: string[]; failed: string[] }>;
    /**
     * 永続キューに積まれた再送待ちの通知を処理する (定期実行タイマーから、または明示的な呼び出しから使う)
     */
    processQueue(limit?: number): Promise<{ sent: number; failed: number }>;
    /**
     * リトライ上限に達し送信を断念した通知の履歴 (設定画面に表示する)
     */
    getFailureHistory(limit?: number): Promise<NotificationFailureHistoryItem[]>;
}
