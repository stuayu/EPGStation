import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import ISeriesMetadataFiller from '../../series/ISeriesMetadataFiller';
import IWorkDictionary from '../../series/IWorkDictionary';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import Series from '../../../db/entities/Series';
import { rankMergeCandidates } from '../../series/SeriesMergeCandidates';
import { getSeriesOrigin } from '../../series/SeriesOrigin';
import * as apid from '../../../../api';
import ISeriesMaintenanceApiModel, {
    RefreshSeriesMetadataResult,
    UpdateSeriesMetadata,
    MergeSeriesResult,
    SplitSeriesResult,
    EmptySeriesListResult,
    DeleteEmptySeriesResult,
    DictionaryWorkSearchResult,
    CreateSeriesFromDictionaryOption,
    CreateSeriesFromDictionaryResult,
} from './ISeriesMaintenanceApiModel';
@injectable()
export default class SeriesMaintenanceApiModel implements ISeriesMaintenanceApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('ISeriesMetadataFiller') private metadataFiller: ISeriesMetadataFiller,
        @inject('IWorkDictionary') private dictionary: IWorkDictionary,
    ) {}

    private static readonly SEASON_NAMES: ReadonlySet<string> = new Set(['WINTER', 'SPRING', 'SUMMER', 'AUTUMN']);
    // マージ候補を DB から引くときの接頭辞の長さ。短くして取りこぼしを防ぎ、絞り込みは JS 側で行う
    private static readonly LOOKUP_PREFIX_LENGTH = 2;
    private static readonly LOOKUP_LIMIT = 500;
    private static readonly CANDIDATE_LIMIT = 30;
    // コメントの最大文字数。しょぼいカレンダーの作品コメントは実測で 3KB 前後あるため余裕を持たせる
    private static readonly MAX_COMMENT_LENGTH = 20000;
    // シリーズ表示名の最大文字数
    private static readonly MAX_TITLE_LENGTH = 500;

    public async updateMetadata(seriesId: number, value: UpdateSeriesMetadata): Promise<void> {
        this.enabled();
        const series = await this.db.getSeries(seriesId);
        if (series === null) throw new Error('SeriesIsNotFound');

        const patch: {
            title?: string;
            titleSource?: string | null;
            titleKana?: string | null;
            seasonYear?: number | null;
            seasonName?: string | null;
            seasonSource?: string | null;
            totalEpisodes?: number | null;
        } = {};

        // 表示名の手動設定。出所を 'manual' にして辞書の再取得で戻されないようにする。
        // 引き当てキー (normalizedTitle) は録画タイトル由来のまま変えない
        if (value.title === null) {
            // 手動設定の解除。表示名はそのまま残し、次回のメタデータ再取得で辞書名へ同期させる
            patch.titleSource = null;
        } else if (typeof value.title !== 'undefined') {
            const title = String(value.title).trim();
            if (title === '' || title.length > SeriesMaintenanceApiModel.MAX_TITLE_LENGTH) {
                throw new Error('InvalidRequestBody');
            }
            patch.title = title;
            patch.titleSource = 'manual';
        }
        if (typeof value.titleKana !== 'undefined') {
            const kana = value.titleKana === null ? null : String(value.titleKana).trim();
            patch.titleKana = kana === '' ? null : kana;
        }
        if (typeof value.totalEpisodes !== 'undefined') {
            const total = value.totalEpisodes === null ? null : Number(value.totalEpisodes);
            if (total !== null && (Number.isInteger(total) === false || total < 0 || total > 10000)) {
                throw new Error('InvalidRequestBody');
            }
            patch.totalEpisodes = total;
        }
        // クールは年と季節をセットで扱う (片方だけ入っていても絞り込みに使えないため)
        if (typeof value.seasonYear !== 'undefined' || typeof value.seasonName !== 'undefined') {
            const year =
                value.seasonYear === null || typeof value.seasonYear === 'undefined' ? null : Number(value.seasonYear);
            const name =
                value.seasonName === null || typeof value.seasonName === 'undefined'
                    ? null
                    : String(value.seasonName).toUpperCase();
            if (year === null && name === null) {
                patch.seasonYear = null;
                patch.seasonName = null;
                patch.seasonSource = null;
            } else {
                if (year === null || Number.isInteger(year) === false || year < 1950 || year > 2200) {
                    throw new Error('InvalidRequestBody');
                }
                if (name === null || SeriesMaintenanceApiModel.SEASON_NAMES.has(name) === false) {
                    throw new Error('InvalidRequestBody');
                }
                patch.seasonYear = year;
                patch.seasonName = name;
                // 手動設定は自動補完で上書きさせない
                patch.seasonSource = 'manual';
            }
        }

        // 作品コメントは series 本体の列なので別経路で更新する。
        // 手動設定・削除のどちらも出所を 'manual' にして、以降の自動取得で書き戻されないようにする
        if (typeof value.comment !== 'undefined') {
            const comment = value.comment === null ? null : String(value.comment).trim();
            if (comment !== null && comment.length > SeriesMaintenanceApiModel.MAX_COMMENT_LENGTH) {
                throw new Error('InvalidRequestBody');
            }
            await this.db.updateSeriesComment(seriesId, comment === '' ? null : comment, 'manual', Date.now());
        }

        if (Object.keys(patch).length === 0) return;
        await this.db.updateExternalMetadata(seriesId, patch);
    }

    public async updateEpisodeComment(episodeId: number, comment: string | null): Promise<void> {
        this.enabled();
        if (typeof episodeId !== 'number' || Number.isInteger(episodeId) === false) {
            throw new Error('InvalidRequestBody');
        }
        const value = comment === null ? null : String(comment).trim();
        if (value !== null && value.length > SeriesMaintenanceApiModel.MAX_COMMENT_LENGTH) {
            throw new Error('InvalidRequestBody');
        }
        const updated = await this.db.updateEpisodeComment(episodeId, value === '' ? null : value, Date.now());
        if (updated === false) throw new Error('SeriesEpisodeIsNotFound');
    }

    public async refreshMetadata(seriesId?: number): Promise<RefreshSeriesMetadataResult> {
        this.enabled();
        if (typeof seriesId === 'undefined') {
            return await this.metadataFiller.fill();
        }

        const series = await this.db.getSeries(seriesId);
        if (series === null) throw new Error('SeriesIsNotFound');

        // 1 件だけの再取得は画面からの明示的な操作なので、埋まっている項目も辞書で引き直す
        return await this.metadataFiller.fill({ seriesIds: [seriesId], force: true });
    }

    async merge(fromSeriesIds: number[], toSeriesId: number): Promise<MergeSeriesResult> {
        this.enabled();
        if (typeof toSeriesId !== 'number' || !Array.isArray(fromSeriesIds)) throw new Error('InvalidRequestBody');
        // 統合先が統合元に混ざっていても事故らないよう、ここで取り除いてから重複を潰す
        const sources = [...new Set(fromSeriesIds)].filter(x => typeof x === 'number' && x !== toSeriesId);
        if (sources.length === 0) throw new Error('InvalidRequestBody');
        const to = await this.db.getSeries(toSeriesId);
        if (!to) throw new Error('SeriesIsNotFound');
        for (const id of sources) {
            if ((await this.db.getSeries(id)) === null) throw new Error('SeriesIsNotFound');
        }
        let movedLinkCount = 0;
        for (const id of sources) {
            movedLinkCount += await this.db.mergeSeries(id, toSeriesId);
        }
        return { movedLinkCount, mergedSeriesCount: sources.length };
    }

    public async listMergeCandidates(seriesId: number): Promise<apid.SeriesMergeCandidateResult> {
        this.enabled();
        const target = await this.db.getSeries(seriesId);
        if (!target) throw new Error('SeriesIsNotFound');

        // 前方一致の候補は「相手が対象で始まる」「対象が相手で始まる」の両方を拾う必要がある。
        // どちらの場合も先頭数文字は共通するため、短い接頭辞で引いてから JS 側で一致種別を判定する
        const prefix = target.normalizedTitle.slice(0, SeriesMaintenanceApiModel.LOOKUP_PREFIX_LENGTH);
        const rows = await this.db.findByNormalizedTitlePrefix(
            prefix,
            SeriesMaintenanceApiModel.LOOKUP_LIMIT,
            target.id,
        );
        const ranked = rankMergeCandidates(target, rows, { limit: SeriesMaintenanceApiModel.CANDIDATE_LIMIT });
        const recordedRows = await this.db
            .listRecordedForSeriesIds(ranked.map(x => x.item.id))
            .catch(() => new Map<number, unknown[]>());

        return {
            seriesId: target.id,
            title: target.title,
            normalizedTitle: target.normalizedTitle,
            origin: getSeriesOrigin(target),
            candidates: ranked.map(x => ({
                seriesId: x.item.id,
                title: x.item.title,
                normalizedTitle: x.item.normalizedTitle,
                origin: getSeriesOrigin(x.item),
                recordedCount: recordedRows.get(x.item.id)?.length ?? 0,
                seasonYear: x.item.seasonYear,
                seasonName: (x.item.seasonName ?? null) as apid.SeriesMergeCandidate['seasonName'],
                matchType: x.matchType,
                commonPrefixLength: x.commonPrefixLength,
            })),
        };
    }
    async split(seriesId: number, recordedIds: number[], newTitle: string): Promise<SplitSeriesResult> {
        this.enabled();
        if (!Array.isArray(recordedIds) || recordedIds.length === 0 || recordedIds.some(x => typeof x !== 'number'))
            throw new Error('InvalidRequestBody');
        if (typeof newTitle !== 'string' || newTitle.trim() === '') throw new Error('InvalidRequestBody');
        const source = await this.db.getSeries(seriesId);
        if (!source) throw new Error('SeriesIsNotFound');
        const newSeries = await this.db.splitSeries(seriesId, recordedIds, newTitle.trim());
        return { seriesId: newSeries.id, title: newSeries.title };
    }
    /**
     * 録画が 0 件のシリーズを列挙する
     * @return Promise<EmptySeriesListResult>
     */
    public async listEmpty(): Promise<EmptySeriesListResult> {
        this.enabled();
        const rows = await this.db.listEmptySeries();
        return {
            total: rows.length,
            items: rows.map(row => {
                return {
                    seriesId: row.series.id,
                    title: row.series.title,
                    normalizedTitle: row.series.normalizedTitle,
                    origin: getSeriesOrigin({
                        syobocalTid: row.series.syobocalTid,
                        annictId: row.series.annictId,
                        wikidataQid: row.series.wikidataQid,
                    }),
                    seasonYear: row.series.seasonYear ?? undefined,
                    seasonName: (row.series.seasonName as apid.EmptySeriesItem['seasonName']) ?? undefined,
                    aliasCount: row.aliasCount,
                    episodeCount: row.episodeCount,
                    createdAt: row.series.createdAt,
                    updatedAt: row.series.updatedAt,
                };
            }),
        };
    }

    /**
     * 録画が 0 件のシリーズを削除する
     * @param seriesIds: number[] | undefined 削除対象。省略時は録画 0 件のシリーズをすべて削除する
     * @return Promise<DeleteEmptySeriesResult>
     */
    public async deleteEmpty(seriesIds?: number[]): Promise<DeleteEmptySeriesResult> {
        this.enabled();
        const rows = await this.db.listEmptySeries();
        let targets = rows;
        if (typeof seriesIds !== 'undefined') {
            if (Array.isArray(seriesIds) === false || seriesIds.length === 0) throw new Error('InvalidRequestBody');
            if (seriesIds.some(id => Number.isInteger(id) === false)) throw new Error('InvalidRequestBody');
            const emptyIds = new Set(rows.map(row => row.series.id));
            // 録画が残っているシリーズが 1 つでも含まれていたら一切削除しない
            if (seriesIds.some(id => emptyIds.has(id) === false)) throw new Error('SeriesIsNotEmpty');
            const requested = new Set(seriesIds);
            targets = rows.filter(row => requested.has(row.series.id));
        }
        const deletedAliasCount = targets.reduce((sum, row) => sum + row.aliasCount, 0);
        const deletedEpisodeCount = targets.reduce((sum, row) => sum + row.episodeCount, 0);
        const deletedSeriesCount = await this.db.deleteSeriesByIds(targets.map(row => row.series.id));
        return {
            deletedSeriesCount: deletedSeriesCount,
            deletedAliasCount: deletedAliasCount,
            deletedEpisodeCount: deletedEpisodeCount,
        };
    }

    /**
     * 作品辞書をキーワードで横断検索する
     * @param keyword: string 検索キーワード
     * @param limit: number | undefined 最大件数
     * @return Promise<DictionaryWorkSearchResult>
     */
    public async searchDictionary(keyword: string, limit?: number): Promise<DictionaryWorkSearchResult> {
        this.enabled();
        const trimmed = typeof keyword === 'string' ? keyword.trim() : '';
        if (trimmed === '') throw new Error('InvalidRequestBody');
        const matches = await this.dictionary.search(trimmed, limit);
        const items: apid.DictionaryWorkItem[] = [];
        for (const match of matches) {
            // すでにローカルにある作品は「登録済み」として見せたいのでシリーズ id を引く
            const series = await this.findSeriesByExternalIds(match);
            items.push({
                title: match.title,
                titleKana: match.titleKana,
                syobocalTid: match.syobocalTid,
                annictId: match.annictId,
                wikidataQid: match.wikidataQid,
                tmdbId: match.tmdbId,
                seasonYear: match.seasonYear,
                seasonName: match.seasonName,
                totalEpisodes: match.totalEpisodes,
                source: match.source,
                matchType: match.matchType,
                seriesId: series === null ? null : series.id,
            });
        }
        return { total: items.length, items: items };
    }

    /**
     * 辞書の作品からシリーズを作る
     * @param option: CreateSeriesFromDictionaryOption 外部 ID (いずれか 1 つ以上)
     * @return Promise<CreateSeriesFromDictionaryResult>
     */
    public async createFromDictionary(
        option: CreateSeriesFromDictionaryOption,
    ): Promise<CreateSeriesFromDictionaryResult> {
        this.enabled();
        const syobocalTid =
            typeof option?.syobocalTid === 'number' && Number.isInteger(option.syobocalTid) ? option.syobocalTid : null;
        const annictId =
            typeof option?.annictId === 'number' && Number.isInteger(option.annictId) ? option.annictId : null;
        const wikidataQid =
            typeof option?.wikidataQid === 'string' && option.wikidataQid.trim() !== ''
                ? option.wikidataQid.trim()
                : null;
        if (syobocalTid === null && annictId === null && wikidataQid === null) throw new Error('InvalidRequestBody');

        // クライアントから来た ID をそのまま信用せず、辞書を引き直して作品情報を確定させる
        const work = await this.dictionary.findByIds({
            syobocalTid: syobocalTid,
            annictId: annictId,
            wikidataQid: wikidataQid,
        });
        if (work === null) throw new Error('DictionaryWorkIsNotFound');

        // 同じ外部 ID のシリーズがすでにあれば重複を作らない
        const sameIds = await this.findSeriesByExternalIds(work);
        if (sameIds !== null) return { seriesId: sameIds.id, title: sameIds.title, created: false };

        // 外部 ID が未設定のまま自動生成されたシリーズと衝突しないよう、正規化タイトルでも見る
        const normalizedTitle = normalizeSeriesTitle(work.title);
        const sameTitle = (await this.db.findCandidates(normalizedTitle)).find(
            x => x.normalizedTitle === normalizedTitle,
        );
        if (typeof sameTitle !== 'undefined') return { seriesId: sameTitle.id, title: sameTitle.title, created: false };

        const now = Date.now();
        const created = await this.db.createSeries({
            title: work.title,
            normalizedTitle: normalizedTitle,
            preferredChannelId: null,
            syobocalTid: work.syobocalTid,
            annictId: work.annictId === null ? null : String(work.annictId),
            wikidataQid: work.wikidataQid,
            tmdbId: work.tmdbId,
            titleKana: work.titleKana,
            seasonYear: work.seasonYear,
            seasonName: work.seasonName,
            totalEpisodes: work.totalEpisodes,
            createdAt: now,
            updatedAt: now,
        });
        return { seriesId: created.id, title: created.title, created: true };
    }

    /**
     * 辞書の外部 ID から既存シリーズを引く (しょぼいカレンダー → Annict → Wikidata の順)
     * @param ids: 外部 ID を持つ作品情報
     * @return Promise<Series | null>
     */
    private async findSeriesByExternalIds(ids: {
        syobocalTid: number | null;
        annictId: number | null;
        wikidataQid: string | null;
    }): Promise<Series | null> {
        if (ids.syobocalTid !== null) {
            const series = await this.db.findBySyobocalTid(ids.syobocalTid);
            if (series !== null) return series;
        }
        if (ids.annictId !== null) {
            const series = await this.db.findByAnnictId(String(ids.annictId));
            if (series !== null) return series;
        }
        if (ids.wikidataQid !== null) {
            const series = await this.db.findByWikidataQid(ids.wikidataQid);
            if (series !== null) return series;
        }
        return null;
    }

    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
