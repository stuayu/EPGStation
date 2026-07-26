import NotificationQueue from '../../db/entities/NotificationQueue';
export interface NewNotificationQueueItem {
    targetName: string;
    eventType: string;
    payload: string;
    nextAttemptAt: number;
    now: number;
}
export interface MarkFailedOption {
    attempts: number;
    nextAttemptAt: number;
    lastError: string;
    terminal: boolean;
}
export default interface INotificationQueueDB {
    enqueue(value: NewNotificationQueueItem): Promise<NotificationQueue>;
    findDue(now: number, limit: number): Promise<NotificationQueue[]>;
    markSent(id: number, now: number): Promise<void>;
    markFailed(id: number, option: MarkFailedOption): Promise<void>;
    /**
     * 失敗履歴 (status: 'failed', 最終的にリトライ上限に達したもの) を新しい順に返す。設定画面に表示する
     */
    listFailed(limit?: number): Promise<NotificationQueue[]>;
}
