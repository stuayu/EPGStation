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
} from './ISeriesApiModel';
@injectable()
export default class SeriesApiModel implements ISeriesApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}
    async list(keyword?: string, offset = 0, limit = 30): Promise<SeriesListResult> {
        return (await this.repository.get('/series', { params: { keyword, offset, limit } })).data;
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
    public async merge(fromSeriesId: number, toSeriesId: number): Promise<apid.MergeSeriesResult> {
        return (await this.repository.post('/series/merge', { fromSeriesId, toSeriesId })).data;
    }
    public async split(seriesId: number, recordedIds: number[], newTitle: string): Promise<apid.SplitSeriesResult> {
        return (await this.repository.post(`/series/${seriesId}/split`, { recordedIds, newTitle })).data;
    }
    public async listAliases(seriesId?: number): Promise<SeriesAliasItem[]> {
        return (await this.repository.get('/series/aliases', { params: { seriesId } })).data;
    }
    public async removeAlias(aliasId: number): Promise<void> {
        await this.repository.delete(`/series/aliases/${aliasId}`);
    }
}
