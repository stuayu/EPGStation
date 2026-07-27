import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../FeatureFlags';
import ISeriesDB from '../db/ISeriesDB';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ISeriesMetadataFiller, { SeriesMetadataFillResult } from './ISeriesMetadataFiller';
import IWorkDictionary from './IWorkDictionary';

/**
 * 既存シリーズのクール (seasonYear/seasonName)・読み仮名・総話数・外部 ID を
 * 作品辞書から埋めるモデル。
 *
 * これらの項目は作品辞書の導入より前に作られたシリーズには入っていないため、
 * 一覧のクール絞り込みやあいうえお順が機能しない。利用者に手動実行を強いないよう
 * Operator 起動後に一度自動で走らせ、設定画面からも実行できるようにしている。
 */
@injectable()
export default class SeriesMetadataFiller implements ISeriesMetadataFiller {
    // 起動から実行までの待ち時間。作品辞書の同期 (しょぼいカレンダー 60 秒後 / Annict 5 分後) の
    // 後に走らせたいので、それらより十分に遅らせる
    private static readonly INITIAL_DELAY_MS = 10 * 60 * 1000;

    private log: ILogger;
    private scheduled: boolean = false;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('IWorkDictionary') private workDictionary: IWorkDictionary,
    ) {
        this.log = logger.getLogger();
    }

    public async fill(): Promise<SeriesMetadataFillResult> {
        const all = await this.db.findAllSeries();
        // クールを録画から推測するための最古録画日時 (1 クエリでまとめて引く)
        const firstAiredAt = await this.db.findFirstAiredAtMap().catch(() => new Map<number, number>());
        let updated = 0;
        let estimated = 0;

        for (const series of all) {
            // 手動設定済みのクールは自動補完で上書きしない
            const seasonIsLocked = series.seasonSource === 'manual';
            const needsSeason = seasonIsLocked === false && (series.seasonYear === null || series.seasonName === null);
            if (
                series.titleKana !== null &&
                series.totalEpisodes !== null &&
                needsSeason === false &&
                series.syobocalTid !== null &&
                series.annictId !== null
            ) {
                continue;
            }

            const patch: {
                syobocalTid?: number | null;
                annictId?: string | null;
                titleKana?: string | null;
                seasonYear?: number | null;
                seasonName?: string | null;
                seasonSource?: string | null;
                totalEpisodes?: number | null;
            } = {};

            // 1. 作品辞書から埋める (最も確度が高い)
            const match = await this.workDictionary.lookup(series.title).catch(() => null);
            if (match !== null) {
                if (series.syobocalTid === null && match.syobocalTid !== null) patch.syobocalTid = match.syobocalTid;
                if (series.annictId === null && match.annictId !== null) patch.annictId = String(match.annictId);
                if (series.titleKana === null && match.titleKana !== null) patch.titleKana = match.titleKana;
                if (series.totalEpisodes === null && match.totalEpisodes !== null) {
                    patch.totalEpisodes = match.totalEpisodes;
                }
                if (needsSeason === true && match.seasonYear !== null && match.seasonName !== null) {
                    patch.seasonYear = match.seasonYear;
                    patch.seasonName = match.seasonName;
                    patch.seasonSource = 'dictionary';
                }
            }

            // 2. 辞書で埋まらなかったクールは、最古の録画日時から推測する。
            //    録画のある作品はこれで必ず埋まるので、一覧のクール絞り込みが機能しなくならない
            if (needsSeason === true && typeof patch.seasonYear === 'undefined') {
                const season = SeriesMetadataFiller.estimateSeason(firstAiredAt.get(series.id));
                if (season !== null) {
                    patch.seasonYear = season.year;
                    patch.seasonName = season.name;
                    patch.seasonSource = 'estimated';
                    estimated++;
                }
            }

            if (Object.keys(patch).length === 0) continue;
            await this.db.updateExternalMetadata(series.id, patch);
            updated++;
        }
        this.log.system.debug(`series metadata: estimated season for ${estimated} series`);
        return { scanned: all.length, updated };
    }

    /**
     * 最古の録画開始日時からクールを推測する (1-3 冬 / 4-6 春 / 7-9 夏 / 10-12 秋)。
     * 初回放送とは限らない (再放送を先に録っている場合がある) ため、辞書で確定できなかった場合の
     * 代替として使い、出所を 'estimated' として記録する
     */
    private static estimateSeason(
        startAt: number | undefined,
    ): { year: number; name: 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN' } | null {
        if (typeof startAt !== 'number' || Number.isFinite(startAt) === false || startAt <= 0) return null;
        const date = new Date(startAt);
        const month = date.getMonth() + 1;
        const name =
            month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : ('AUTUMN' as const);
        return { year: date.getFullYear(), name };
    }

    public scheduleInitialFill(): void {
        if (this.scheduled === true) return;
        this.scheduled = true;

        const timer = setTimeout(() => {
            void (async () => {
                const config = this.config.getConfig();
                if (
                    isFeatureEnabled(config, 'seriesLibrary') === false ||
                    isFeatureEnabled(config, 'metadataProviders') === false
                ) {
                    return;
                }
                try {
                    const result = await this.fill();
                    if (result.updated > 0) {
                        this.log.system.info(
                            `series metadata: filled ${result.updated}/${result.scanned} series from the work dictionary`,
                        );
                    }
                } catch (err) {
                    this.log.system.warn('series metadata: initial fill failed');
                    this.log.system.warn(err);
                }
            })();
        }, SeriesMetadataFiller.INITIAL_DELAY_MS);
        if (typeof timer.unref === 'function') timer.unref();
    }
}
