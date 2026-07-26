import { createHmac, randomUUID } from 'crypto';
import { NotificationEventType, NotificationTargetConfig } from '../IConfigFile';
import { NotificationEvent } from './INotificationDispatcher';
export interface NotificationRequest {
    body: string;
    headers: Record<string, string>;
}
export function createNotificationEvent(
    type: NotificationEventType,
    payload: Record<string, unknown>,
    now = Date.now(),
): NotificationEvent {
    return { id: randomUUID(), type, occurredAt: now, payload };
}
export function buildNotificationRequest(
    target: NotificationTargetConfig,
    event: NotificationEvent,
): NotificationRequest {
    const data =
        target.type === 'discord'
            ? {
                  embeds: [
                      {
                          title: eventTitle(event.type),
                          description: String(event.payload.name ?? ''),
                          color: event.type === 'recording.failed' ? 15158332 : 5763719,
                          fields: Object.entries(event.payload)
                              .filter(([k]) => k !== 'name')
                              .slice(0, 10)
                              .map(([name, value]) => ({ name, value: String(value), inline: true })),
                          timestamp: new Date(event.occurredAt).toISOString(),
                      },
                  ],
              }
            : event;
    const body = JSON.stringify(data);
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        'user-agent': 'EPGStation-Notification/1.0',
        'x-epgstation-event': event.type,
        'x-epgstation-delivery': event.id,
    };
    if (target.secret)
        headers['x-epgstation-signature-256'] =
            `sha256=${createHmac('sha256', target.secret).update(body).digest('hex')}`;
    return { body, headers };
}
function eventTitle(type: NotificationEventType): string {
    return type === 'recording.started'
        ? '録画を開始しました'
        : type === 'recording.completed'
          ? '録画が完了しました'
          : '録画に失敗しました';
}
