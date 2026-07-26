/* eslint-disable max-len */
import { inject, injectable } from 'inversify';
import { Like } from 'typeorm';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import SeriesEpisode from '../../db/entities/SeriesEpisode';
import IDBOperator from './IDBOperator';
import ISeriesDB, { NewEpisode, NewSeries, SaveSeriesLink, SeriesChannelRow, SeriesRecordedRow } from './ISeriesDB';
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
    public async list(keyword: string | undefined, offset: number, limit: number): Promise<[Series[], number]> {
        const c = await this.op.getConnection();
        const where = keyword
            ? [{ title: Like(`%${keyword}%`) }, { normalizedTitle: Like(`%${keyword}%`) }]
            : undefined;
        return await c
            .getRepository(Series)
            .findAndCount({ where, order: { updatedAt: 'DESC' }, skip: offset, take: limit });
    }
    public async getSeries(id: number): Promise<Series | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(Series).findOne({ where: { id } });
    }
    public async listRecorded(seriesId: number, channelId?: number): Promise<SeriesRecordedRow[]> {
        const c = await this.op.getConnection();
        const params: Array<number> = [seriesId];
        let channel = '';
        if (typeof channelId === 'number') {
            channel = ' AND r.channelId = ?';
            params.push(channelId);
        }
        return await c.manager.query(
            `SELECT l.recordedId, r.channelId, r.channelName, r.name AS recordedTitle, r.startAt, r.endAt, l.episodeId, e.seasonNumber, e.episodeNumber, e.episodeLabel, e.title AS episodeTitle, l.airType, l.confidence FROM recorded_series_link l JOIN recorded r ON r.id = l.recordedId LEFT JOIN series_episode e ON e.id = l.episodeId WHERE l.seriesId = ?${channel} ORDER BY COALESCE(e.seasonNumber, 1), COALESCE(e.episodeNumber, 999999), r.startAt`,
            params,
        );
    }
    public async listChannels(seriesId: number): Promise<SeriesChannelRow[]> {
        const c = await this.op.getConnection();
        return await c.manager.query(
            'SELECT r.channelId, r.channelName, COUNT(*) AS count FROM recorded_series_link l JOIN recorded r ON r.id = l.recordedId WHERE l.seriesId = ? GROUP BY r.channelId, r.channelName ORDER BY r.channelName',
            [seriesId],
        );
    }
}
