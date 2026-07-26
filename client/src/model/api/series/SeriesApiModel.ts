import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import ISeriesApiModel, { SeriesDetail, SeriesListResult } from './ISeriesApiModel';
@injectable()
export default class SeriesApiModel implements ISeriesApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}
    async list(keyword?: string, offset = 0, limit = 30): Promise<SeriesListResult> {
        return (await this.repository.get('/series', { params: { keyword, offset, limit } })).data;
    }
    async get(id: number, channelId?: number): Promise<SeriesDetail> {
        return (await this.repository.get(`/series/${id}`, { params: { channelId } })).data;
    }
}
