import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import { NotificationEventType, NotificationTargetConfig } from '../IConfigFile';
import INotificationDispatcher from './INotificationDispatcher';
import { buildNotificationRequest, createNotificationEvent } from './NotificationRequest';
@injectable()
export default class NotificationDispatcher implements INotificationDispatcher {
    private log: ILogger;
    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.log = logger.getLogger();
    }
    public async dispatch(type: NotificationEventType, payload: Record<string, unknown>): Promise<void> {
        const config = this.configuration.getConfig();
        if (!isFeatureEnabled(config, 'notifications') || !config.notifications) return;
        const event = createNotificationEvent(type, payload);
        const targets = config.notifications.targets.filter(t => !t.events || t.events.includes(type));
        await Promise.all(
            targets.map(t =>
                this.deliver(
                    t,
                    event,
                    config.notifications?.maxAttempts ?? 5,
                    config.notifications?.baseDelayMs ?? 1000,
                    config.notifications?.timeoutMs ?? 10000,
                ),
            ),
        );
    }
    private async deliver(
        target: NotificationTargetConfig,
        event: ReturnType<typeof createNotificationEvent>,
        max: number,
        base: number,
        timeout: number,
    ): Promise<void> {
        const request = buildNotificationRequest(target, event);
        let last: unknown;
        for (let attempt = 1; attempt <= Math.max(1, max); attempt++) {
            try {
                const response = await fetch(target.url, {
                    method: 'POST',
                    headers: request.headers,
                    body: request.body,
                    signal: AbortSignal.timeout(timeout),
                });
                if (!response.ok) throw new Error(`NotificationHttpStatus:${response.status}`);
                return;
            } catch (err) {
                last = err;
                if (attempt < max) await new Promise(resolve => setTimeout(resolve, base * 2 ** (attempt - 1)));
            }
        }
        this.log.system.error(`notification delivery failed: ${target.name}`);
        this.log.system.error(last);
    }
}
