import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import ISeriesApiModel, { SeriesDetail, SeriesListResult, SeriesMapping, UpdateSeriesMapping } from './ISeriesApiModel';
@injectable()
export default class SeriesApiModel implements ISeriesApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}
    async list(keyword?: string, offset = 0, limit = 30): Promise<SeriesListResult> {
        return (await this.repository.get('/series', { params: { keyword, offset, limit } })).data;
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
    public async syncAnnict(seriesId: number): Promise<{ annictId: string; syobocalTid: number | null; title: string; score: number }> {
        return (await this.repository.post(`/series/${seriesId}/metadata/annict`)).data;
    }
}
