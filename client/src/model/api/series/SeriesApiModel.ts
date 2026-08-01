import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import ISeriesApiModel, {
    SeriesDetail,
    SeriesListResult,
    SeriesMapping,
    SeriesPendingListResult,
    SeriesAliasItem,
    UpdateSeriesMapping,
    MissingEpisodeProposal,
    SeriesBackfillOption,
    SeriesBackfillResult,
    SeriesAnalyzeResult,
    ProgramSeriesMetrics,
    SeriesListOption,
    UpdateSeriesMetadata,
    RefreshSeriesMetadataResult,
    EmptySeriesListResult,
    DeleteEmptySeriesResult,
    DictionaryWorkItem,
    DictionaryWorkSearchResult,
    CreateSeriesFromDictionaryResult,
} from './ISeriesApiModel';
@injectable()
export default class SeriesApiModel implements ISeriesApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}
    async list(option: SeriesListOption = {}): Promise<SeriesListResult> {
        const params = {
            keyword: option.keyword || undefined,
            offset: option.offset ?? 0,
            limit: option.limit ?? 30,
            sort: option.sort,
            order: option.order,
            seasonYear: option.seasonYear,
            seasonName: option.seasonName,
            status: option.status,
            origin: option.origin,
            hasMissing: option.hasMissing === true ? true : undefined,
        };
        return (await this.repository.get('/series', { params })).data;
    }
    async listSeasons(): Promise<apid.SeriesSeasonItem[]> {
        return (await this.repository.get('/series/seasons')).data;
    }
    async refreshMetadata(seriesId?: number): Promise<RefreshSeriesMetadataResult> {
        return (await this.repository.post('/series/refresh-metadata', typeof seriesId === 'number' ? { seriesId } : {}))
            .data;
    }
    async updateSeriesMetadata(seriesId: number, value: UpdateSeriesMetadata): Promise<void> {
        await this.repository.put(`/series/${seriesId}/metadata`, value);
    }
    public async updateEpisodeComment(episodeId: number, comment: string | null): Promise<void> {
        await this.repository.put(`/series/episodes/${episodeId}/comment`, { comment });
    }
    public async getMissingEpisodeProposals(seriesId: number): Promise<MissingEpisodeProposal[]> {
        return (await this.repository.get(`/series/${seriesId}/missing-episodes/proposals`)).data.proposals;
    }
    async get(id: number, channelId?: number): Promise<SeriesDetail> {
        return (await this.repository.get(`/series/${id}`, { params: { channelId } })).data;
    }
    public async getMapping(recordedId: number): Promise<SeriesMapping | null> {
        try {
            return (await this.repository.get(`/series/mappings/${recordedId}`)).data;
        } catch (e: any) {
            if (e?.response?.status === 404) return null;
            throw e;
        }
    }
    public async updateMapping(recordedId: number, value: UpdateSeriesMapping): Promise<SeriesMapping> {
        return (await this.repository.put(`/series/mappings/${recordedId}`, value)).data;
    }
    public async removeMapping(recordedId: number): Promise<void> {
        await this.repository.delete(`/series/mappings/${recordedId}`);
    }
    public async undoMapping(recordedId: number): Promise<SeriesMapping | null> {
        return (await this.repository.post(`/series/mappings/${recordedId}/undo`)).data;
    }
    public async syncAnnict(seriesId: number): Promise<{ annictId: string; syobocalTid: number | null; title: string; score: number }> {
        return (await this.repository.post(`/series/${seriesId}/metadata/annict`)).data;
    }
    public async listPending(offset = 0, limit = 30): Promise<SeriesPendingListResult> {
        return (await this.repository.get('/series/pending', { params: { offset, limit } })).data;
    }
    public async confirmPending(pendingId: number, value: UpdateSeriesMapping): Promise<SeriesMapping> {
        return (await this.repository.put(`/series/pending/${pendingId}`, value)).data;
    }
    public async rejectPending(pendingId: number): Promise<void> {
        await this.repository.delete(`/series/pending/${pendingId}`);
    }
    public async merge(fromSeriesIds: number[], toSeriesId: number): Promise<apid.MergeSeriesResult> {
        return (await this.repository.post('/series/merge', { fromSeriesIds, toSeriesId })).data;
    }
    public async getMergeCandidates(seriesId: number): Promise<apid.SeriesMergeCandidateResult> {
        return (await this.repository.get(`/series/${seriesId}/merge-candidates`)).data;
    }
    public async updateMappingBulk(
        items: apid.BulkSeriesMappingItem[],
    ): Promise<apid.BulkUpdateSeriesMappingResult> {
        return (await this.repository.post('/series/mappings/bulk', { items })).data;
    }
    public async split(seriesId: number, recordedIds: number[], newTitle: string): Promise<apid.SplitSeriesResult> {
        return (await this.repository.post(`/series/${seriesId}/split`, { recordedIds, newTitle })).data;
    }
    /**
     * 録画が 0 件のシリーズを取得する
     * @return Promise<EmptySeriesListResult>
     */
    public async listEmptySeries(): Promise<EmptySeriesListResult> {
        return (await this.repository.get('/series/empty')).data;
    }
    /**
     * 録画が 0 件のシリーズを削除する
     * @param seriesIds: number[] | undefined 省略時は録画 0 件のシリーズをすべて削除する
     * @return Promise<DeleteEmptySeriesResult>
     */
    public async deleteEmptySeries(seriesIds?: number[]): Promise<DeleteEmptySeriesResult> {
        return (await this.repository.delete('/series/empty', { data: typeof seriesIds === 'undefined' ? {} : { seriesIds } })).data;
    }
    /**
     * 作品辞書をキーワードで横断検索する
     * @param keyword: string 検索キーワード
     * @param limit: number | undefined 最大件数
     * @return Promise<DictionaryWorkSearchResult>
     */
    public async searchDictionary(keyword: string, limit?: number): Promise<DictionaryWorkSearchResult> {
        return (await this.repository.get('/series/dictionary', { params: { keyword, limit } })).data;
    }
    /**
     * 辞書の作品からシリーズを作る
     * @param work: DictionaryWorkItem 検索結果 1 件
     * @return Promise<CreateSeriesFromDictionaryResult>
     */
    public async createSeriesFromDictionary(work: DictionaryWorkItem): Promise<CreateSeriesFromDictionaryResult> {
        return (
            await this.repository.post('/series/dictionary', {
                syobocalTid: work.syobocalTid ?? null,
                annictId: work.annictId ?? null,
                wikidataQid: work.wikidataQid ?? null,
            })
        ).data;
    }
    public async listAliases(seriesId?: number): Promise<SeriesAliasItem[]> {
        return (await this.repository.get('/series/aliases', { params: { seriesId } })).data;
    }
    public async updateAlias(aliasId: number, value: apid.UpdateSeriesAliasOption): Promise<SeriesAliasItem> {
        return (await this.repository.put(`/series/aliases/${aliasId}`, value)).data;
    }
    public async updateAliasBulk(items: apid.BulkSeriesAliasItem[]): Promise<apid.BulkUpdateSeriesAliasResult> {
        return (await this.repository.post('/series/aliases/bulk', { items })).data;
    }
    public async removeAlias(aliasId: number): Promise<void> {
        await this.repository.delete(`/series/aliases/${aliasId}`);
    }
    public async startBackfill(option?: SeriesBackfillOption): Promise<SeriesBackfillResult> {
        return (await this.repository.post('/series/backfill', option ?? {})).data;
    }
    public async getBackfillStatus(): Promise<SeriesBackfillResult> {
        return (await this.repository.get('/series/backfill/status')).data;
    }
    public async cancelBackfill(): Promise<void> {
        await this.repository.delete('/series/backfill');
    }
    public async analyze(recordedId: apid.RecordedId): Promise<SeriesAnalyzeResult> {
        return (await this.repository.post(`/series/analyze/${recordedId}`, {})).data;
    }
    public async reserveMissingEpisode(seriesId: number, seasonNumber: number, episodeNumber: number, programId: number): Promise<{ reserveId: number }> {
        return (await this.repository.post(`/series/${seriesId}/missing-episodes/reserve`, { seasonNumber, episodeNumber, programId })).data;
    }
    public async getMetrics(): Promise<ProgramSeriesMetrics> {
        return (await this.repository.get('/schedules/series-metrics')).data;
    }
}
