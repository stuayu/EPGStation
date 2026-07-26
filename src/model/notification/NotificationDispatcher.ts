import { inject, injectable } from 'inversify';
import NotificationQueue from '../../db/entities/NotificationQueue';
import IAppSettingDB from '../db/IAppSettingDB';
import INotificationQueueDB from '../db/INotificationQueueDB';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import { NotificationConfig, NotificationEventType, NotificationTargetConfig } from '../IConfigFile';
import ISecretCrypto from '../security/ISecretCrypto';
import INotificationDispatcher, { NotificationEvent, NotificationFailureHistoryItem } from './INotificationDispatcher';
import { buildNotificationRequest, createNotificationEvent } from './NotificationRequest';
import { assertNotificationUrlIsAllowed } from './NotificationUrlGuard';

/**
 * 通知配送 (§7.3)。
 * - 即時配信をまず 1 回試みる。失敗した場合は永続キュー (notification_queue) に積み、
 *   バックグラウンドワーカー (このクラス自身の定期処理) が指数バックオフで最大 maxAttempts 回まで再試行する。
 *   Service プロセスが再起動してもキューに残っている限り再送が継続される
 * - SSRF 対策: URL のスキームを http/https に限定し、allowPrivateNetworkTargets が
 *   明示的に true でない限りループバック/プライベート IP 宛の配送を拒否する (ブラインド SSRF 対策)
 */
@injectable()
export default class NotificationDispatcher implements INotificationDispatcher {
    private static readonly MAX_ATTEMPTS_CAP = 20;
    private static readonly PROCESS_INTERVAL_MS = 30 * 1000;
    private static readonly DEFAULT_LIMIT = 20;

    private log: ILogger;
    private timer: NodeJS.Timeout | null = null;

    constructor(
        @inject('IConfiguration') private configuration: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISecretCrypto') private crypto: ISecretCrypto,
        @inject('INotificationQueueDB') private queueDB: INotificationQueueDB,
    ) {
        this.log = logger.getLogger();
        this.scheduleProcessing();
    }

    public async dispatch(type: NotificationEventType, payload: Record<string, unknown>): Promise<void> {
        const c = await this.getConfig();
        if (!c) return;
        const event = createNotificationEvent(type, payload);
        const targets = c.targets.filter(t => !t.events || t.events.includes(type));
        await Promise.all(targets.map(t => this.deliverOrEnqueue(t, event, c)));
    }

    public async test(targetName?: string): Promise<{ delivered: string[]; failed: string[] }> {
        const c = await this.getConfig();
        if (!c) throw new Error('NotificationConfigIsDisabled');
        const targets = typeof targetName === 'string' ? c.targets.filter(t => t.name === targetName) : c.targets;
        if (targets.length === 0) throw new Error('NotificationTargetIsNotFound');
        const event = createNotificationEvent('recording.completed', { name: 'EPGStation 通知テスト', test: true });
        const results = await Promise.all(
            targets.map(async t => ({ name: t.name, ok: await this.deliverOnce(t, event, c) })),
        );
        return {
            delivered: results.filter(x => x.ok).map(x => x.name),
            failed: results.filter(x => !x.ok).map(x => x.name),
        };
    }

    /**
     * 永続キューに積まれた再送待ちの通知を処理する (定期実行タイマー、または明示的な呼び出しから使う)
     * @param limit: 1 回の実行で処理する最大件数
     */
    public async processQueue(limit = NotificationDispatcher.DEFAULT_LIMIT): Promise<{ sent: number; failed: number }> {
        const c = await this.getConfig();
        if (!c) return { sent: 0, failed: 0 };
        const due = await this.queueDB.findDue(Date.now(), limit);
        let sent = 0;
        let failed = 0;
        const maxAttempts = Math.min(NotificationDispatcher.MAX_ATTEMPTS_CAP, Math.max(1, c.maxAttempts ?? 5));
        for (const row of due) {
            const target = c.targets.find(t => t.name === row.targetName);
            if (!target) {
                await this.queueDB.markFailed(row.id, {
                    attempts: row.attempts + 1,
                    nextAttemptAt: Date.now(),
                    lastError: 'NotificationTargetIsNotFound',
                    terminal: true,
                });
                failed++;
                continue;
            }
            let event: NotificationEvent;
            try {
                event = JSON.parse(row.payload);
            } catch {
                await this.queueDB.markFailed(row.id, {
                    attempts: row.attempts + 1,
                    nextAttemptAt: Date.now(),
                    lastError: 'NotificationPayloadIsInvalid',
                    terminal: true,
                });
                failed++;
                continue;
            }
            const ok = await this.deliverOnce(target, event, c);
            if (ok) {
                await this.queueDB.markSent(row.id, Date.now());
                sent++;
                continue;
            }
            const attempts = row.attempts + 1;
            const baseDelay = c.baseDelayMs ?? 1000;
            const delay = Math.min(baseDelay * 2 ** attempts, 6 * 60 * 60 * 1000);
            const terminal = attempts >= maxAttempts;
            await this.queueDB.markFailed(row.id, {
                attempts,
                nextAttemptAt: Date.now() + delay,
                lastError: 'NotificationDeliveryFailed',
                terminal,
            });
            failed++;
        }
        return { sent, failed };
    }

    /**
     * リトライ上限に達し送信を断念した通知の履歴 (設定画面に表示する)
     */
    public async getFailureHistory(limit = 50): Promise<NotificationFailureHistoryItem[]> {
        const rows = await this.queueDB.listFailed(limit);
        return rows.map(r => this.historyItem(r));
    }

    private historyItem(r: NotificationQueue): NotificationFailureHistoryItem {
        return {
            id: r.id,
            targetName: r.targetName,
            eventType: r.eventType as NotificationEventType,
            attempts: r.attempts,
            lastError: r.lastError,
            updatedAt: Number(r.updatedAt),
        };
    }

    private async deliverOrEnqueue(
        target: NotificationTargetConfig,
        event: NotificationEvent,
        c: NotificationConfig,
    ): Promise<void> {
        const ok = await this.deliverOnce(target, event, c);
        if (ok) return;
        const now = Date.now();
        const baseDelay = c.baseDelayMs ?? 1000;
        await this.queueDB
            .enqueue({
                targetName: target.name,
                eventType: event.type,
                payload: JSON.stringify(event),
                nextAttemptAt: now + baseDelay,
                now,
            })
            .catch(err => {
                this.log.system.error(`failed to enqueue notification retry: ${target.name}`);
                this.log.system.error(err);
            });
    }

    private scheduleProcessing(): void {
        this.timer = setInterval(() => {
            this.processQueue().catch(err => {
                this.log.system.error('notification queue processing error');
                this.log.system.error(err);
            });
        }, NotificationDispatcher.PROCESS_INTERVAL_MS);
        this.timer.unref?.();
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
                allowPrivateNetworkTargets: runtime.allowPrivateNetworkTargets === true,
                targets: runtime.targets.map((t: any) => ({
                    ...t,
                    secret: this.tryDecrypt(t.secret, t.name),
                    // Discord Webhook URL 等も設定画面では暗号化して保存されているため復号する。
                    // 復号できない (secretKey 未設定・ローテーション後) 場合は配送先が特定できないため
                    // その対象への配送はスキップする (url をそのまま欠落させる)
                    url: this.tryDecrypt(t.url, t.name),
                })),
            };
        }
        return root.notifications ?? null;
    }

    /**
     * secret / url など暗号化されている可能性のある値を復号する。
     * secretKey 未設定・鍵ローテーション後などで復号できない場合は例外を投げず、
     * ログに残した上で元の値 (暗号文) をそのまま返す (配信は URL ガードで弾かれ失敗として扱われる)
     */
    private tryDecrypt(value: unknown, targetName: string): unknown {
        if (typeof value !== 'string' || !this.crypto.isEncrypted(value)) return value;
        try {
            return this.crypto.decrypt(value);
        } catch (e) {
            this.log.system.error(`failed to decrypt notification target value: ${targetName}`);
            this.log.system.error(e);
            return value;
        }
    }

    /**
     * 1 回だけ配信を試みる (SSRF ガード込み)。永続キュー・即時配信・test() から共通で使う
     */
    private async deliverOnce(
        target: NotificationTargetConfig,
        event: NotificationEvent,
        c: NotificationConfig,
    ): Promise<boolean> {
        try {
            await assertNotificationUrlIsAllowed(target.url, c.allowPrivateNetworkTargets === true);
        } catch (e) {
            this.log.system.error(`notification target url is not allowed: ${target.name}`);
            this.log.system.error(e);
            return false;
        }
        const request = buildNotificationRequest(target, event);
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
            this.log.system.error(`notification delivery failed: ${target.name}`);
            this.log.system.error(e);
            return false;
        }
    }
}
