import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IAnnictWorkDictionary from '../../metadata/annict/IAnnictWorkDictionary';
import ISyobocalTitleDictionary from '../../metadata/syobocal/ISyobocalTitleDictionary';
import ISeriesBackfillManageModel from './ISeriesBackfillManageModel';
import ISeriesStartupPipeline from './ISeriesStartupPipeline';

/**
 * サーバー (Operator) 起動時に、作品辞書の同期完了を待ってから
 * 未リンク録画のシリーズ照合バックフィルまでを全自動で実行するパイプライン。
 * - 辞書の初回自動同期 (SyobocalTitleDictionary: 起動 1 分後 / AnnictWorkDictionary: 起動 5 分後) が
 *   走り出した後に開始し、両辞書の同期が終わるのを待ってからバックフィルを開始する
 * - 既定では「シリーズ未リンクの録画だけを先頭から再照合」する (restart + onlyUnlinked)。
 *   リンク済み録画には触れないため冪等で、辞書更新や LLM フォールバック追加の効果を起動のたびに取り込める
 * - seriesStartup.enable: false で無効化できる
 */
@injectable()
export default class SeriesStartupPipeline implements ISeriesStartupPipeline {
    // 起動からパイプライン開始までの待機 (Annict の初回自動同期開始 5 分より後にする)
    private static readonly DEFAULT_DELAY_MS = 7 * 60 * 1000;
    // 辞書同期の完了待ちの上限
    private static readonly DEFAULT_DICTIONARY_WAIT_MS = 30 * 60 * 1000;
    private static readonly DICTIONARY_POLL_INTERVAL_MS = 20 * 1000;
    // バックフィルの進捗確認間隔と完了待ちの上限
    private static readonly BACKFILL_POLL_INTERVAL_MS = 30 * 1000;
    private static readonly BACKFILL_WAIT_MS = 6 * 60 * 60 * 1000;

    private log: ILogger;
    private config: IConfigFile;

    private scheduled: boolean = false;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('ISyobocalTitleDictionary') private syobocal: ISyobocalTitleDictionary,
        @inject('IAnnictWorkDictionary') private annict: IAnnictWorkDictionary,
        @inject('ISeriesBackfillManageModel') private backfill: ISeriesBackfillManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
    }

    public schedule(): void {
        if (this.scheduled === true) return;
        this.scheduled = true;

        if (isFeatureEnabled(this.config, 'seriesLibrary') === false) return;
        if (this.config.seriesStartup?.enable === false) return;

        const delay = this.positive(this.config.seriesStartup?.delayMs, SeriesStartupPipeline.DEFAULT_DELAY_MS);
        const timer = setTimeout(() => {
            void this.run().catch(err => {
                this.log.system.error('series startup pipeline: unexpected error');
                this.log.system.error(err);
            });
        }, delay);
        if (typeof timer.unref === 'function') timer.unref();

        this.log.system.info(`series startup pipeline: scheduled (in ${Math.round(delay / 1000)} sec)`);
    }

    private async run(): Promise<void> {
        await this.waitForDictionaries();

        const rescan = this.config.seriesStartup?.rescanUnlinked !== false;
        this.log.system.info(
            `series startup pipeline: starting backfill (${
                rescan === true ? 'rescan all unlinked recordings' : 'resume from last position'
            })`,
        );
        await this.backfill.start(rescan === true ? { restart: true, onlyUnlinked: true } : {});
        await this.waitForBackfill();
    }

    /**
     * 起動時の辞書自動同期 (しょぼいカレンダー + Annict) が終わるまで待つ。
     * 連携が無効な場合は running が立たないためすぐに抜ける
     */
    private async waitForDictionaries(): Promise<void> {
        if (isFeatureEnabled(this.config, 'metadataProviders') === false) return;

        const waitMs = this.positive(
            this.config.seriesStartup?.dictionaryWaitMs,
            SeriesStartupPipeline.DEFAULT_DICTIONARY_WAIT_MS,
        );
        const limit = Date.now() + waitMs;
        let waited = false;
        while (Date.now() < limit) {
            const [syobocal, annict] = await Promise.all([this.syobocal.getStatus(), this.annict.getStatus()]);
            if (syobocal.running === false && annict.running === false) {
                if (waited === true) this.log.system.info('series startup pipeline: dictionary sync finished');

                return;
            }
            waited = true;
            await this.sleep(SeriesStartupPipeline.DICTIONARY_POLL_INTERVAL_MS);
        }
        this.log.system.warn('series startup pipeline: dictionary sync wait timed out. starting backfill anyway');
    }

    /**
     * バックフィルの完了を待ち、結果をログへ出す
     */
    private async waitForBackfill(): Promise<void> {
        const limit = Date.now() + SeriesStartupPipeline.BACKFILL_WAIT_MS;
        while (Date.now() < limit) {
            const status = await this.backfill.getStatus();
            if (status.state !== 'running') {
                this.log.system.info(
                    `series startup pipeline: backfill ${status.state} ` +
                        `(processed: ${status.processed}, linked: ${status.linked}, pending: ${status.pending}, ` +
                        `skipped: ${status.skipped}, failed: ${status.failed})`,
                );

                return;
            }
            await this.sleep(SeriesStartupPipeline.BACKFILL_POLL_INTERVAL_MS);
        }
        this.log.system.warn('series startup pipeline: backfill is still running (gave up waiting for completion)');
    }

    private positive(value: number | undefined, fallback: number): number {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
