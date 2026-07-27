import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../FeatureFlags';
import Series from '../../db/entities/Series';
import ISeriesDB from '../db/ISeriesDB';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ILlmTitleExtractor from './ILlmTitleExtractor';
import ISeriesMetadataFiller, { SeriesMetadataFillResult } from './ISeriesMetadataFiller';
import IWorkDictionary, { WorkMatch } from './IWorkDictionary';

/**
 * 既存シリーズのクール (seasonYear/seasonName)・読み仮名・総話数・外部 ID を
 * 作品辞書から埋めるモデル。
 *
 * これらの項目は作品辞書の導入より前に作られたシリーズには入っていないため、
 * 一覧のクール絞り込みやあいうえお順が機能しない。利用者に手動実行を強いないよう
 * Operator 起動後に一度自動で走らせ、設定画面からも実行できるようにしている。
 *
 * 作品辞書で引けなかったシリーズには LLM フォールバックを掛ける (seriesLlm 設定時のみ)。
 * 録画単位で引く SeriesResolver と違い対象はシリーズ数に比例するため呼び出し回数が桁違いに少なく、
 * 1 件当たれば配下の全録画に外部 ID (話数逆引き・クール・画像) が波及する
 */
@injectable()
export default class SeriesMetadataFiller implements ISeriesMetadataFiller {
    // 起動から実行までの待ち時間。作品辞書の同期 (しょぼいカレンダー 60 秒後 / Annict 5 分後) の
    // 後に走らせたいので、それらより十分に遅らせる
    private static readonly INITIAL_DELAY_MS = 10 * 60 * 1000;
    // 1 回の fill() で LLM へ問い合わせるシリーズ数の上限。
    // 抽出結果は永続キャッシュされるため、初回で溢れても次回以降の実行で続きが進む
    private static readonly LLM_MAX_PER_RUN = 200;

    private log: ILogger;
    private scheduled: boolean = false;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('IWorkDictionary') private workDictionary: IWorkDictionary,
        @inject('ILlmTitleExtractor') private llmExtractor: ILlmTitleExtractor,
    ) {
        this.log = logger.getLogger();
    }

    public async fill(): Promise<SeriesMetadataFillResult> {
        const all = await this.db.findAllSeries();
        // クールを録画から推測するための最古録画日時 (1 クエリでまとめて引く)
        const firstAiredAt = await this.db.findFirstAiredAtMap().catch(() => new Map<number, number>());
        let updated = 0;
        let estimated = 0;
        let llmAnalyzed = 0;
        let llmResolved = 0;
        const llmEnabled = this.isLlmEnabled();
        let llmSuspended = false;

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
            let match = await this.workDictionary.lookup(series.title).catch(() => null);

            // 1-2. 辞書で引けず外部 ID も未設定のシリーズだけ LLM フォールバックへ回す。
            //      シリーズ名に編成枠名・サブタイトル・話数が残っていて辞書キーに当たらない場合を救う。
            //      抽出結果は必ず辞書で引き直すため、LLM の誤生成だけで外部 ID が入ることはない
            if (
                match === null &&
                llmEnabled === true &&
                llmSuspended === false &&
                series.syobocalTid === null &&
                series.annictId === null &&
                llmAnalyzed < SeriesMetadataFiller.LLM_MAX_PER_RUN
            ) {
                // レート制限・連続失敗で休止に入ったら、残りのシリーズは次回の実行へ回す。
                // 休止中は問い合わせ自体が行われず即 null が返るため、そのまま回し続けると
                // 残り全件を「抽出できなかった」として無駄に消化してしまう
                if (this.llmExtractor.isSuspended() === true) {
                    llmSuspended = true;
                    this.log.system.warn(
                        'series metadata: llm is suspended, deferring the remaining series to the next run',
                    );
                } else {
                    llmAnalyzed++;
                    match = await this.lookupViaLlm(series.title);
                    if (match !== null) {
                        llmResolved++;
                        // 対応をエイリアス辞書へ学習させ、以後は SeriesResolver が LLM も辞書も引かずに確定できるようにする
                        await this.learnAlias(series, match);
                    }
                }
            }

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
        if (llmAnalyzed > 0) {
            this.log.system.info(
                `series metadata: llm resolved ${llmResolved}/${llmAnalyzed} series that the work dictionary missed`,
            );
        }

        return { scanned: all.length, updated, llmAnalyzed, llmResolved };
    }

    /**
     * LLM にシリーズ名から作品名を抽出させ、その作品名で作品辞書を引き直す。
     * LLM 未設定・抽出失敗 (非アニメ含む)・辞書に該当なしの場合は null を返す
     * @param seriesTitle: string シリーズ名
     * @return Promise<Awaited<ReturnType<IWorkDictionary['lookup']>>>
     */
    private async lookupViaLlm(seriesTitle: string): Promise<Awaited<ReturnType<IWorkDictionary['lookup']>>> {
        try {
            const extracted = await this.llmExtractor.extractWorkTitle(seriesTitle);
            if (extracted === null) return null;

            return await this.workDictionary.lookup(extracted);
        } catch {
            return null;
        }
    }

    /**
     * 「シリーズの正規化タイトル → シリーズ」の対応をエイリアス辞書へ記録する (マッチングルールの学習)。
     * 以後は同じ表記の録画を SeriesResolver がエイリアスだけで確定でき、LLM への問い合わせが不要になる。
     * エイリアスは確度 1.0 の強い規則なので、LLM の抽出結果が辞書キーと完全一致した場合のみ学習する
     * @param series: Series 対象シリーズ
     * @param match: WorkMatch 辞書の照合結果
     */
    private async learnAlias(series: Series, match: WorkMatch): Promise<void> {
        if (typeof series.normalizedTitle !== 'string' || series.normalizedTitle === '') return;
        if (match.matchType !== 'exact') return;
        try {
            // 手動修正で作られた既存のエイリアスを自動学習で上書きしない
            const current = await this.db.findAlias(series.normalizedTitle);
            if (current !== null) return;
            await this.db.upsertAlias(series.normalizedTitle, series.id, Date.now(), 'llm');
        } catch {
            // 学習に失敗してもメタデータの補完自体は成立しているので握りつぶす
        }
    }

    /**
     * LLM フォールバックが使えるか。DI されていない (古い呼び出し) 場合も無効として扱う
     */
    private isLlmEnabled(): boolean {
        try {
            return this.llmExtractor?.isEnabled() === true;
        } catch {
            return false;
        }
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
