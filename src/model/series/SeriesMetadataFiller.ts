import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../FeatureFlags';
import Series from '../../db/entities/Series';
import ISeriesDB from '../db/ISeriesDB';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ISyobocalTitleDictionary from '../metadata/syobocal/ISyobocalTitleDictionary';
import ILlmTitleExtractor from './ILlmTitleExtractor';
import ISeriesMetadataFiller, { SeriesMetadataFillOption, SeriesMetadataFillResult } from './ISeriesMetadataFiller';
import IWorkDictionary, { WorkMatch } from './IWorkDictionary';
import { isDerivedFromTitle } from './SeriesNormalizer';

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
    // 1 回の fill() で作品コメントを取りに行くシリーズ数の上限。
    // TID ごとに 1 リクエスト必要なので、初回で溢れても次回以降の実行で続きが進む
    private static readonly COMMENT_MAX_PER_RUN = 300;
    // 上限で繰り越しが出た場合に、続きを実行するまでの待ち時間
    private static readonly FOLLOW_UP_DELAY_MS = 10 * 60 * 1000;
    // 自動で続きを実行する最大回数 (取りこぼしが延々と残る状況で無限に叩き続けないための歯止め)
    private static readonly MAX_FOLLOW_UP_RUNS = 20;

    private log: ILogger;
    private scheduled: boolean = false;
    private followUpRuns: number = 0;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('IWorkDictionary') private workDictionary: IWorkDictionary,
        @inject('ILlmTitleExtractor') private llmExtractor: ILlmTitleExtractor,
        @inject('ISyobocalTitleDictionary') private syobocalDictionary: ISyobocalTitleDictionary,
    ) {
        this.log = logger.getLogger();
    }

    public async fill(option?: SeriesMetadataFillOption): Promise<SeriesMetadataFillResult> {
        const targetIds = Array.isArray(option?.seriesIds) ? new Set(option.seriesIds) : null;
        // 1 件だけの再取得 (シリーズ詳細画面) では、すでに埋まっている項目も引き直したい
        const force = option?.force === true;
        const all = (await this.db.findAllSeries()).filter(s => targetIds === null || targetIds.has(s.id));
        // クールを録画から推測するための最古録画日時 (1 クエリでまとめて引く)
        const firstAiredAt = await this.db.findFirstAiredAtMap().catch(() => new Map<number, number>());
        let updated = 0;
        let titleSynced = 0;
        let estimated = 0;
        let llmAnalyzed = 0;
        let llmResolved = 0;
        let commentFetched = 0;
        let commentFilled = 0;
        // コメントを引けなかった理由の内訳 (取れていないときに原因を切り分けられるようにする)
        let commentSkippedNoTid = 0;
        let commentDeferred = 0;
        const llmEnabled = this.isLlmEnabled();
        let llmSuspended = false;

        for (const series of all) {
            // 手動設定済みのクールは自動補完で上書きしない
            const seasonIsLocked = series.seasonSource === 'manual';
            const needsSeason =
                seasonIsLocked === false &&
                (force === true || series.seasonYear === null || series.seasonName === null);
            // 手動で編集・削除したコメントは自動取得で書き戻さない
            const needsComment =
                series.commentSource !== 'manual' && (force === true || typeof series.comment !== 'string');
            // 表示名を作品辞書の正式タイトルへ合わせる。手動で付けた名前は上書きしない。
            // すでに辞書名へ同期済みでも、辞書側の表記が変わることがあるため引き直す
            const needsTitle = series.titleSource !== 'manual';
            // 作品辞書から埋めるものが残っているか。コメントは辞書本体には無く TID 指定で個別に引くため、
            // ここには含めない (コメントだけが未取得のシリーズで辞書を引き直さない)
            const needsDictionary =
                force === true ||
                series.titleKana === null ||
                series.totalEpisodes === null ||
                needsSeason === true ||
                series.syobocalTid === null ||
                series.annictId === null ||
                needsTitle === true;
            if (needsDictionary === false && needsComment === false) continue;

            const patch: {
                title?: string;
                titleSource?: string | null;
                syobocalTid?: number | null;
                annictId?: string | null;
                wikidataQid?: string | null;
                tmdbId?: number | null;
                titleKana?: string | null;
                seasonYear?: number | null;
                seasonName?: string | null;
                seasonSource?: string | null;
                totalEpisodes?: number | null;
            } = {};

            // 1. 作品辞書から埋める (最も確度が高い)
            let match =
                needsDictionary === false ? null : await this.workDictionary.lookup(series.title).catch(() => null);

            // 1-2. 辞書で引けず外部 ID も未設定のシリーズだけ LLM フォールバックへ回す。
            //      シリーズ名に編成枠名・サブタイトル・話数が残っていて辞書キーに当たらない場合を救う。
            //      抽出結果は必ず辞書で引き直すため、LLM の誤生成だけで外部 ID が入ることはない
            if (
                match === null &&
                needsDictionary === true &&
                llmEnabled === true &&
                llmSuspended === false &&
                series.syobocalTid === null &&
                series.annictId === null &&
                series.wikidataQid === null &&
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
                // 表示名を外部辞書の正式タイトルへ合わせる。
                // 引き当てキー (normalizedTitle) は録画タイトル由来のまま残す (既存の紐付けを壊さないため)
                if (needsTitle === true && match.title !== '' && match.title !== series.title) {
                    patch.title = match.title;
                    patch.titleSource = 'dictionary';
                    titleSynced++;
                    this.log.system.info(
                        `series title synced: seriesId=${series.id} "${series.title}" -> "${match.title}" (${match.source})`,
                    );
                } else if (needsTitle === true && match.title === series.title && series.titleSource === null) {
                    // すでに辞書名と一致しているものは、以後引き直さなくて済むよう出所だけ記録する
                    patch.titleSource = 'dictionary';
                }
                // force 指定 (画面からの明示的な再取得) では、すでに入っている値も辞書の値で上書きする
                if ((force === true || series.syobocalTid === null) && match.syobocalTid !== null) {
                    patch.syobocalTid = match.syobocalTid;
                }
                if ((force === true || series.annictId === null) && match.annictId !== null) {
                    patch.annictId = String(match.annictId);
                }
                if ((force === true || series.wikidataQid === null) && match.wikidataQid !== null) {
                    patch.wikidataQid = match.wikidataQid;
                }
                if ((force === true || series.tmdbId === null) && match.tmdbId !== null) patch.tmdbId = match.tmdbId;
                if ((force === true || series.titleKana === null) && match.titleKana !== null) {
                    patch.titleKana = match.titleKana;
                }
                if ((force === true || series.totalEpisodes === null) && match.totalEpisodes !== null) {
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

            // 3. 作品コメントを取得する。1 作品あたり数 KB あり全件同期には含めていないため、
            //    シリーズになっている作品だけを TID 指定で個別に引く
            const syobocalTid = patch.syobocalTid ?? series.syobocalTid;
            if (needsComment === true && typeof syobocalTid !== 'number') {
                // TID が無い作品はコメントを引く手段が無い (辞書に当たっていない)
                commentSkippedNoTid++;
            } else if (
                needsComment === true &&
                typeof syobocalTid === 'number' &&
                commentFetched < SeriesMetadataFiller.COMMENT_MAX_PER_RUN
            ) {
                commentFetched++;
                const comment = await this.fetchComment(syobocalTid);
                if (comment !== null) {
                    await this.db.updateSeriesComment(series.id, comment, 'dictionary', Date.now()).catch(() => {});
                    commentFilled++;
                } else {
                    this.log.system.debug(
                        `series metadata: no comment for seriesId=${series.id} (TID ${syobocalTid}, ${series.title})`,
                    );
                }
            } else if (needsComment === true) {
                // 1 回の上限に達したぶんは次回の実行へ回る
                commentDeferred++;
            }

            if (Object.keys(patch).length === 0) continue;
            await this.db.updateExternalMetadata(series.id, patch);
            updated++;
        }
        if (commentFetched > 0 || commentSkippedNoTid > 0 || commentDeferred > 0) {
            this.log.system.info(
                `series metadata: comments filled ${commentFilled}/${commentFetched}` +
                    ` (しょぼいカレンダー TID 無しで取得不可: ${commentSkippedNoTid} 件、上限超過で次回へ繰り越し: ${commentDeferred} 件)`,
            );
        }
        this.log.system.debug(`series metadata: estimated season for ${estimated} series`);
        if (llmAnalyzed > 0) {
            this.log.system.info(
                `series metadata: llm resolved ${llmResolved}/${llmAnalyzed} series that the work dictionary missed`,
            );
        }

        if (titleSynced > 0) {
            this.log.system.info(`series metadata: synced ${titleSynced} series title(s) with the work dictionary`);
        }

        return {
            scanned: all.length,
            updated,
            titleSynced,
            llmAnalyzed,
            llmResolved,
            commentFetched,
            commentFilled,
            commentPending: commentDeferred,
            commentSkippedNoTid,
        };
    }

    /**
     * しょぼいカレンダーから作品コメントを取得する。
     * 連携が無効・取得失敗・DI 未注入 (古い呼び出し) の場合は null を返す
     * @param syobocalTid: number
     * @return Promise<string | null>
     */
    private async fetchComment(syobocalTid: number): Promise<string | null> {
        try {
            return (await this.syobocalDictionary?.fetchComment(syobocalTid)) ?? null;
        } catch {
            return null;
        }
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
            // 実在する別作品の名前を返す誤りを落とす (辞書で引けてしまうため辞書検証だけでは防げない)
            if (isDerivedFromTitle(seriesTitle, extracted) === false) return null;

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
        const name = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : ('AUTUMN' as const);
        return { year: date.getFullYear(), name };
    }

    public scheduleInitialFill(): void {
        if (this.scheduled === true) return;
        this.scheduled = true;

        this.scheduleRun(SeriesMetadataFiller.INITIAL_DELAY_MS);
    }

    /**
     * delayMs 後に fill() を 1 回実行する。
     * コメント取得が 1 回あたりの上限で繰り越された場合は、間隔を空けて続きを自動実行する
     * (作品コメントは TID ごとに 1 リクエスト必要で、しょぼいカレンダーのレート制限もあるため
     *  1 回では全件を取り切れない。利用者に手動実行を繰り返させないための自動追走)
     * @param delayMs: number
     */
    private scheduleRun(delayMs: number): void {
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
                    if (result.commentPending > 0 && this.followUpRuns < SeriesMetadataFiller.MAX_FOLLOW_UP_RUNS) {
                        this.followUpRuns++;
                        this.log.system.info(
                            `series metadata: ${result.commentPending} comments remain, scheduling a follow-up run` +
                                ` (${this.followUpRuns}/${SeriesMetadataFiller.MAX_FOLLOW_UP_RUNS})`,
                        );
                        this.scheduleRun(SeriesMetadataFiller.FOLLOW_UP_DELAY_MS);
                    }
                } catch (err) {
                    this.log.system.warn('series metadata: fill failed');
                    this.log.system.warn(err);
                }
            })();
        }, delayMs);
        if (typeof timer.unref === 'function') timer.unref();
    }
}
