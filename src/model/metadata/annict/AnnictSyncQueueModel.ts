import { inject, injectable } from 'inversify';
import Series from '../../../db/entities/Series';
import { resolveBoolean } from '../../AppSettingResolver';
import IAnnictWatchSyncDB from '../../db/IAnnictWatchSyncDB';
import IAppSettingDB from '../../db/IAppSettingDB';
import ISeriesDB from '../../db/ISeriesDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IMetadataService from '../IMetadataService';
import IAnnictSyncQueueModel, { AnnictSyncQueueProcessResult } from './IAnnictSyncQueueModel';

/**
 * Annict 視聴記録の双方向同期キュー (§5.5)。
 * - トリガー: WatchHistory が watched へ遷移した録画 (WatchHistoryApiModel から呼ばれる)
 * - キュー: annict_watch_sync テーブルに永続化し、Service プロセス再起動後も再送を継続する
 * - 障害分離: Annict 障害時は視聴履歴の更新自体を失敗させない (呼び出し元は結果を待たない)
 * - 二重送信防止: (seriesId, seriesEpisodeId) の一意制約 + 送信済み行の保持
 * - リトライ: 指数バックオフ (1分 → 最大6時間、最大8回)
 */
@injectable()
export default class AnnictSyncQueueModel implements IAnnictSyncQueueModel {
    private static readonly BASE_DELAY_MS = 60 * 1000; // 1分
    private static readonly MAX_DELAY_MS = 6 * 60 * 60 * 1000; // 6時間
    private static readonly MAX_ATTEMPTS = 8;
    private static readonly PROCESS_INTERVAL_MS = 60 * 1000;
    private static readonly DEFAULT_LIMIT = 10;
    private timer: NodeJS.Timeout | null = null;

    constructor(
        @inject('IConfiguration') private readonly config: IConfiguration,
        @inject('ISeriesDB') private readonly seriesDB: ISeriesDB,
        @inject('IAnnictWatchSyncDB') private readonly queueDB: IAnnictWatchSyncDB,
        @inject('IMetadataService') private readonly metadata: IMetadataService,
        @inject('IAppSettingDB') private readonly settingsDB: IAppSettingDB,
    ) {
        this.scheduleProcessing();
    }

    public enqueueFromWatchHistory(recordedId: number): void {
        this.enabled()
            .then(enabled => {
                if (!enabled) return;
                return this.resolveAndEnqueue(recordedId).then(() => this.processQueue());
            })
            .catch(() => undefined);
    }

    public async enqueueSeries(seriesId: number): Promise<{ queued: number }> {
        if (!(await this.enabled())) throw new Error('AnnictSyncFeatureIsDisabled');
        const series = await this.seriesDB.getSeries(seriesId);
        if (!series) throw new Error('SeriesIsNotFound');
        const annictId = series.annictId ?? (await this.resolveAnnictId(series));
        if (!annictId) throw new Error('AnnictWorkIsNotFound');
        const rows = await this.seriesDB.listRecorded(seriesId);
        let queued = 0;
        for (const row of rows) {
            if (row.episodeId === null || row.episodeNumber === null) continue;
            const episode = await this.seriesDB.findEpisodeById(row.episodeId);
            if (!episode || episode.episodeNumber === null) continue;
            await this.queueDB.enqueue({
                recordedId: row.recordedId,
                seriesId,
                seriesEpisodeId: episode.id,
                annictWorkId: annictId,
                episodeNumber: episode.episodeNumber,
                now: Date.now(),
            });
            queued++;
        }
        this.processQueue().catch(() => undefined);
        return { queued };
    }

    public async processQueue(limit = AnnictSyncQueueModel.DEFAULT_LIMIT): Promise<AnnictSyncQueueProcessResult> {
        if (!(await this.enabled())) return { processed: 0, sent: 0, failed: 0 };
        const due = await this.queueDB.findDue(Date.now(), limit);
        let sent = 0;
        let failed = 0;
        for (const row of due) {
            try {
                const result = await this.metadata.pushWatchRecord(
                    'annict',
                    row.annictWorkId,
                    row.episodeNumber,
                    'watched',
                );
                if (result === null) throw new Error('AnnictSyncIsNotConfigured');
                await this.queueDB.markSent(row.id, Date.now());
                sent++;
            } catch (e) {
                const attempts = row.attempts + 1;
                const delay = Math.min(
                    AnnictSyncQueueModel.BASE_DELAY_MS * 2 ** (attempts - 1),
                    AnnictSyncQueueModel.MAX_DELAY_MS,
                );
                const terminal = attempts >= AnnictSyncQueueModel.MAX_ATTEMPTS;
                await this.queueDB.markFailed(row.id, {
                    attempts,
                    nextAttemptAt: Date.now() + delay,
                    lastError: e instanceof Error ? e.message : String(e),
                    terminal,
                });
                failed++;
            }
        }
        return { processed: due.length, sent, failed };
    }

    /**
     * 視聴履歴 → シリーズ → 話数を辿ってキューへ積む。annictId 未確定の場合は syobocalTid を
     * キーにした一意確定検索を試み、確定できなければ諦める (次回 watched 遷移時に再試行される)
     */
    private async resolveAndEnqueue(recordedId: number): Promise<void> {
        const link = await this.seriesDB.findLink(recordedId);
        if (!link || link.episodeId === null) return;
        const series = await this.seriesDB.getSeries(link.seriesId);
        if (!series) return;
        const annictId = series.annictId ?? (await this.resolveAnnictId(series));
        if (!annictId) return;
        const episode = await this.seriesDB.findEpisodeById(link.episodeId);
        if (!episode || episode.episodeNumber === null) return;
        await this.queueDB.enqueue({
            recordedId,
            seriesId: series.id,
            seriesEpisodeId: episode.id,
            annictWorkId: annictId,
            episodeNumber: episode.episodeNumber,
            now: Date.now(),
        });
    }

    /**
     * syobocalTid をキーにした一意確定検索で annictId を解決し、成功したら Series へ永続化する
     * (既存の AnnictSyncApiModel.sync() と同じロジック)
     */
    private async resolveAnnictId(series: Series): Promise<string | null> {
        try {
            const context = series.syobocalTid ? { syobocalTid: Number(series.syobocalTid) } : undefined;
            const results = await this.metadata.search(series.title, context, ['annict']);
            const exact = context ? results.find(x => x.syobocalTid === context.syobocalTid) : undefined;
            const best = exact ?? results[0];
            if (!best || (!exact && best.score < 0.75)) return null;
            await this.seriesDB.updateExternalMetadata(series.id, {
                annictId: best.externalId,
                syobocalTid: best.syobocalTid ?? series.syobocalTid,
            });
            return best.externalId;
        } catch {
            return null;
        }
    }

    private scheduleProcessing(): void {
        if (this.timer !== null) return;
        this.timer = setInterval(() => {
            this.processQueue().catch(() => undefined);
        }, AnnictSyncQueueModel.PROCESS_INTERVAL_MS);
        if (typeof this.timer.unref === 'function') this.timer.unref();
    }

    /**
     * 視聴記録同期の二重ゲート判定 (§5.5・§6.2)。
     * 1. featureFlags.metadataProviders / annictSync (config.yml) が両方 true であること (必須の opt-in)
     * 2. 設定画面 (DB: metadata.annict.syncEnabled) が true であること
     *    (未設定時は既定 true。feature flag を有効化した既存導入で急に同期が止まらないようにするため)
     */
    private async enabled(): Promise<boolean> {
        const c = this.config.getConfig();
        if (!isFeatureEnabled(c, 'metadataProviders') || !isFeatureEnabled(c, 'annictSync')) return false;
        const all = await this.settingsDB.getAll();
        const annictSettings = (all.metadata as any)?.annict;
        return resolveBoolean(annictSettings?.syncEnabled, undefined, true);
    }
}
