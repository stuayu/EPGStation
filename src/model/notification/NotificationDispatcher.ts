import { inject, injectable } from 'inversify';
import IAppSettingDB from '../db/IAppSettingDB';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import { NotificationConfig, NotificationEventType, NotificationTargetConfig } from '../IConfigFile';
import ISecretCrypto from '../security/ISecretCrypto';
import INotificationDispatcher from './INotificationDispatcher';
import { buildNotificationRequest, createNotificationEvent } from './NotificationRequest';
@injectable()
export default class NotificationDispatcher implements INotificationDispatcher {
    private log: ILogger;
    constructor(
        @inject('IConfiguration') private configuration: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISecretCrypto') private crypto: ISecretCrypto,
    ) {
        this.log = logger.getLogger();
    }
    async dispatch(type: NotificationEventType, payload: Record<string, unknown>): Promise<void> {
        const c = await this.getConfig();
        if (!c) return;
        const event = createNotificationEvent(type, payload);
        await Promise.all(
            c.targets
                .filter(t => !t.events || t.events.includes(type))
                .map(t => this.deliver(t, event, c).then(() => undefined)),
        );
    }
    async test(targetName?: string): Promise<{ delivered: string[]; failed: string[] }> {
        const c = await this.getConfig();
        if (!c) throw new Error('NotificationConfigIsDisabled');
        const targets = typeof targetName === 'string' ? c.targets.filter(t => t.name === targetName) : c.targets;
        if (targets.length === 0) throw new Error('NotificationTargetIsNotFound');
        const event = createNotificationEvent('recording.completed', { name: 'EPGStation 通知テスト', test: true });
        const results = await Promise.all(
            targets.map(async t => ({ name: t.name, ok: await this.deliver(t, event, c) })),
        );
        return {
            delivered: results.filter(x => x.ok).map(x => x.name),
            failed: results.filter(x => !x.ok).map(x => x.name),
        };
    }
    private async getConfig(): Promise<NotificationConfig | null> {
        const root = this.configuration.getConfig();
        if (!isFeatureEnabled(root, 'notifications')) return null;
        const runtime = (await this.settings.getAll()).notifications as any;
        if (runtime?.enabled === true && Array.isArray(runtime.targets)) {
            return {
                maxAttempts: runtime.maxAttempts,
                baseDelayMs: runtime.baseDelayMs,
                timeoutMs: runtime.timeoutMs,
                targets: runtime.targets.map((t: any) => ({
                    ...t,
                    secret:
                        typeof t.secret === 'string' && this.crypto.isEncrypted(t.secret)
                            ? this.crypto.decrypt(t.secret)
                            : t.secret,
                })),
            };
        }
        return root.notifications ?? null;
    }
    private async deliver(
        target: NotificationTargetConfig,
        event: ReturnType<typeof createNotificationEvent>,
        c: NotificationConfig,
    ): Promise<boolean> {
        const request = buildNotificationRequest(target, event);
        let last: unknown;
        const max = c.maxAttempts ?? 5;
        for (let attempt = 1; attempt <= Math.max(1, max); attempt++) {
            try {
                const response = await fetch(target.url, {
                    method: 'POST',
                    headers: request.headers,
                    body: request.body,
                    signal: AbortSignal.timeout(c.timeoutMs ?? 10000),
                });
                if (!response.ok) throw new Error(`NotificationHttpStatus:${response.status}`);
                return true;
            } catch (e) {
                last = e;
                if (attempt < max)
                    await new Promise(resolve => setTimeout(resolve, (c.baseDelayMs ?? 1000) * 2 ** (attempt - 1)));
            }
        }
        this.log.system.error(`notification delivery failed: ${target.name}`);
        this.log.system.error(last);
        return false;
    }
}
