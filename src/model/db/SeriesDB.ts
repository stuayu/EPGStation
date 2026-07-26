import { inject, injectable } from 'inversify';
import { Like } from 'typeorm';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import SeriesEpisode from '../../db/entities/SeriesEpisode';
import IDBOperator from './IDBOperator';
import ISeriesDB, { NewEpisode, NewSeries, SaveSeriesLink } from './ISeriesDB';
@injectable()
export default class SeriesDB implements ISeriesDB {
    constructor(@inject('IDBOperator') private op: IDBOperator) {}
    async findCandidates(normalizedTitle: string): Promise<Series[]> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(Series);
        const exact = await repo.find({ where: { normalizedTitle }, take: 20 });
        if (exact.length > 0) return exact;
        const key = normalizedTitle.slice(0, Math.min(4, normalizedTitle.length));
        return key ? await repo.find({ where: { normalizedTitle: Like(`%${key}%`) }, take: 100 }) : [];
    }
    async createSeries(value: NewSeries) {
        const c = await this.op.getConnection();
        const repo = c.getRepository(Series);
        return await repo.save(repo.create(value));
    }
    async findEpisode(seriesId: number, seasonNumber: number, episodeNumber: number | null) {
        if (episodeNumber === null) return null;
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesEpisode).findOne({ where: { seriesId, seasonNumber, episodeNumber } });
    }
    async createEpisode(value: NewEpisode) {
        const c = await this.op.getConnection();
        const repo = c.getRepository(SeriesEpisode);
        return await repo.save(repo.create(value));
    }
    async findLink(recordedId: number) {
        const c = await this.op.getConnection();
        return await c.getRepository(RecordedSeriesLink).findOne({ where: { recordedId } });
    }
    async saveLink(value: SaveSeriesLink) {
        const c = await this.op.getConnection();
        const repo = c.getRepository(RecordedSeriesLink);
        const current = await repo.findOne({ where: { recordedId: value.recordedId } });
        return await repo.save(repo.create({ ...current, ...value, createdAt: current?.createdAt ?? value.createdAt }));
    }
}
