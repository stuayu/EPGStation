import { NotificationEventType } from '../IConfigFile';
export interface NotificationEvent {
    id: string;
    type: NotificationEventType;
    occurredAt: number;
    payload: Record<string, unknown>;
}
export default interface INotificationDispatcher {
    dispatch(type: NotificationEventType, payload: Record<string, unknown>): Promise<void>;
}
