import { inject, injectable } from 'inversify';
import { IsNull, Like, Not } from 'typeorm';
import Recorded from '../../db/entities/Recorded';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import SeriesAlias from '../../db/entities/SeriesAlias';
import SeriesChangeHistory from '../../db/entities/SeriesChangeHistory';
import SeriesEpisode from '../../db/entities/SeriesEpisode';
import SeriesPendingMatch from '../../db/entities/SeriesPendingMatch';
import SeriesReservationHint from '../../db/entities/SeriesReservationHint';
import IDBOperator from './IDBOperator';
import ISeriesDB, {
    NewEpisode,
    NewHistory,
    NewPendingMatch,
    NewReservationHint,
    NewSeries,
    PendingCandidate,
    SaveSeriesLink,
    SeriesChannelRow,
    SeriesRecordedRow,
} from './ISeriesDB';
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
    public async findBySyobocalTid(syobocalTid: number): Promise<Series | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(Series).findOne({ where: { syobocalTid } });
    }
    public async findByAnnictId(annictId: string): Promise<Series | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(Series).findOne({ where: { annictId } });
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
    public async findEpisodeById(id: number): Promise<SeriesEpisode | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesEpisode).findOne({ where: { id } });
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
        let qb = c
            .getRepository(RecordedSeriesLink)
            .createQueryBuilder('l')
            .innerJoin(Recorded, 'r', 'r.id = l.recordedId')
            .leftJoin(SeriesEpisode, 'e', 'e.id = l.episodeId')
            .where('l.seriesId = :seriesId', { seriesId })
            .select('l.recordedId', 'recordedId')
            .addSelect('l.channelId', 'channelId')
            .addSelect('r.channelName', 'channelName')
            .addSelect('r.name', 'recordedTitle')
            .addSelect('r.startAt', 'startAt')
            .addSelect('r.endAt', 'endAt')
            .addSelect('l.episodeId', 'episodeId')
            .addSelect('e.seasonNumber', 'seasonNumber')
            .addSelect('e.episodeNumber', 'episodeNumber')
            .addSelect('e.episodeLabel', 'episodeLabel')
            .addSelect('e.title', 'episodeTitle')
            .addSelect('l.airType', 'airType')
            .addSelect('l.confidence', 'confidence')
            .orderBy('COALESCE(e.seasonNumber, 1)', 'ASC')
            .addOrderBy('COALESCE(e.episodeNumber, 999999)', 'ASC')
            .addOrderBy('r.startAt', 'ASC');
        if (typeof channelId === 'number') qb = qb.andWhere('l.channelId = :channelId', { channelId });
        return await qb.getRawMany<SeriesRecordedRow>();
    }
    public async listChannels(seriesId: number): Promise<SeriesChannelRow[]> {
        const c = await this.op.getConnection();
        // channelId は recorded_series_link に非正規化済みのため recorded への JOIN 無しで集計できる (§4.2)
        return await c
            .getRepository(RecordedSeriesLink)
            .createQueryBuilder('l')
            .innerJoin(Recorded, 'r', 'r.id = l.recordedId')
            .where('l.seriesId = :seriesId', { seriesId })
            .select('l.channelId', 'channelId')
            .addSelect('r.channelName', 'channelName')
            .addSelect('COUNT(*)', 'count')
            .groupBy('l.channelId')
            .addGroupBy('r.channelName')
            .orderBy('r.channelName', 'ASC')
            .getRawMany<SeriesChannelRow>();
    }
    public async deleteLink(recordedId: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(RecordedSeriesLink).delete({ recordedId });
    }
    public async countOtherLinksByEpisode(episodeId: number, recordedId: number): Promise<number> {
        const c = await this.op.getConnection();
        return await c.getRepository(RecordedSeriesLink).count({ where: { episodeId, recordedId: Not(recordedId) } });
    }
    public async updateExternalMetadata(
        id: number,
        value: { annictId?: string | null; syobocalTid?: number | null },
    ): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(Series).update({ id }, { ...value, updatedAt: Date.now() });
    }

    // --- 未確定キュー ---
    public async upsertPendingMatch(value: NewPendingMatch): Promise<SeriesPendingMatch> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(SeriesPendingMatch);
        const current = await repo.findOne({ where: { recordedId: value.recordedId } });
        return await repo.save(
            repo.create({
                id: current?.id,
                recordedId: value.recordedId,
                normalizedTitle: value.normalizedTitle,
                channelId: value.channelId,
                candidatesJson: JSON.stringify(value.candidates),
                createdAt: current?.createdAt ?? value.createdAt,
            }),
        );
    }
    public async listPendingMatches(offset: number, limit: number): Promise<[SeriesPendingMatch[], number]> {
        const c = await this.op.getConnection();
        return await c
            .getRepository(SeriesPendingMatch)
            .findAndCount({ order: { createdAt: 'DESC' }, skip: offset, take: limit });
    }
    public async getPendingMatch(id: number): Promise<SeriesPendingMatch | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesPendingMatch).findOne({ where: { id } });
    }
    public async findPendingMatchByRecordedId(recordedId: number): Promise<SeriesPendingMatch | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesPendingMatch).findOne({ where: { recordedId } });
    }
    public async deletePendingMatchByRecordedId(recordedId: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(SeriesPendingMatch).delete({ recordedId });
    }
    public async deletePendingMatch(id: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(SeriesPendingMatch).delete({ id });
    }
    public static parsePendingCandidates(json: string): PendingCandidate[] {
        try {
            const value = JSON.parse(json);
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }

    // --- エイリアス辞書 ---
    public async findAlias(normalizedTitle: string): Promise<SeriesAlias | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesAlias).findOne({ where: { normalizedTitle } });
    }
    public async upsertAlias(normalizedTitle: string, seriesId: number, createdAt: number): Promise<SeriesAlias> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(SeriesAlias);
        const current = await repo.findOne({ where: { normalizedTitle } });
        return await repo.save(
            repo.create({ id: current?.id, normalizedTitle, seriesId, createdAt: current?.createdAt ?? createdAt }),
        );
    }
    public async listAlias(seriesId?: number): Promise<SeriesAlias[]> {
        const c = await this.op.getConnection();
        return await c
            .getRepository(SeriesAlias)
            .find({ where: typeof seriesId === 'number' ? { seriesId } : undefined, order: { createdAt: 'DESC' } });
    }
    public async deleteAlias(id: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(SeriesAlias).delete({ id });
    }

    // --- 変更履歴 / Undo ---
    public async addHistory(value: NewHistory): Promise<SeriesChangeHistory> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(SeriesChangeHistory);
        return await repo.save(
            repo.create({
                recordedId: value.recordedId,
                action: value.action,
                previousSeriesId: value.previous?.seriesId ?? null,
                previousEpisodeId: value.previous?.episodeId ?? null,
                previousAirType: value.previous?.airType ?? null,
                previousMatchMethod: value.previous?.matchMethod ?? null,
                previousConfidence: value.previous?.confidence ?? null,
                previousManualLock: value.previous?.manualLock ?? null,
                undone: false,
                createdAt: value.createdAt,
            }),
        );
    }
    public async getHistory(id: number): Promise<SeriesChangeHistory | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesChangeHistory).findOne({ where: { id } });
    }
    public async getLatestHistoryForRecorded(recordedId: number): Promise<SeriesChangeHistory | null> {
        const c = await this.op.getConnection();
        return await c
            .getRepository(SeriesChangeHistory)
            .findOne({ where: { recordedId, undone: false }, order: { createdAt: 'DESC' } });
    }
    public async markHistoryUndone(id: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(SeriesChangeHistory).update({ id }, { undone: true });
    }

    // --- マージ / 分割 ---
    public async mergeSeries(fromSeriesId: number, toSeriesId: number): Promise<number> {
        if (fromSeriesId === toSeriesId) return 0;
        const c = await this.op.getConnection();
        return await c.transaction(async manager => {
            const linkRepo = manager.getRepository(RecordedSeriesLink);
            const episodeRepo = manager.getRepository(SeriesEpisode);
            const aliasRepo = manager.getRepository(SeriesAlias);
            const seriesRepo = manager.getRepository(Series);

            const links = await linkRepo.find({ where: { seriesId: fromSeriesId } });
            for (const link of links) {
                // 同一エピソード識別 (season, episodeNumber) が移行先に既にあれば張り替え、無ければ新規作成する
                let newEpisodeId: number | null = null;
                if (link.episodeId !== null) {
                    const src = await episodeRepo.findOne({ where: { id: link.episodeId } });
                    if (src) {
                        const existing = await episodeRepo.findOne({
                            where: {
                                seriesId: toSeriesId,
                                seasonNumber: src.seasonNumber,
                                episodeNumber: src.episodeNumber === null ? IsNull() : src.episodeNumber,
                            },
                        });
                        if (existing) {
                            newEpisodeId = existing.id;
                        } else {
                            const created = await episodeRepo.save(
                                episodeRepo.create({
                                    seriesId: toSeriesId,
                                    seasonNumber: src.seasonNumber,
                                    episodeNumber: src.episodeNumber,
                                    episodeLabel: src.episodeLabel,
                                    title: src.title,
                                    airedAt: src.airedAt,
                                    createdAt: src.createdAt,
                                    updatedAt: Date.now(),
                                }),
                            );
                            newEpisodeId = created.id;
                        }
                    }
                }
                await linkRepo.update({ id: link.id }, { seriesId: toSeriesId, episodeId: newEpisodeId, updatedAt: Date.now() });
            }
            await aliasRepo.update({ seriesId: fromSeriesId }, { seriesId: toSeriesId });
            await episodeRepo.delete({ seriesId: fromSeriesId });
            await seriesRepo.delete({ id: fromSeriesId });
            await seriesRepo.update({ id: toSeriesId }, { updatedAt: Date.now() });
            return links.length;
        });
    }
    public async splitSeries(sourceSeriesId: number, recordedIds: number[], newTitle: string): Promise<Series> {
        if (recordedIds.length === 0) throw new Error('SplitTargetIsEmpty');
        const c = await this.op.getConnection();
        return await c.transaction(async manager => {
            const linkRepo = manager.getRepository(RecordedSeriesLink);
            const seriesRepo = manager.getRepository(Series);
            const now = Date.now();
            const source = await seriesRepo.findOne({ where: { id: sourceSeriesId } });
            if (!source) throw new Error('SeriesIsNotFound');
            const newSeries = await seriesRepo.save(
                seriesRepo.create({
                    title: newTitle,
                    normalizedTitle: source.normalizedTitle,
                    mediaType: source.mediaType,
                    preferredChannelId: null,
                    syobocalTid: null,
                    annictId: null,
                    tmdbId: null,
                    createdAt: now,
                    updatedAt: now,
                }),
            );
            // 分割後は話数の対応関係が崩れるため episodeId はクリアし、再解決 (再割当) に委ねる
            for (const recordedId of recordedIds) {
                await linkRepo.update(
                    { recordedId, seriesId: sourceSeriesId },
                    { seriesId: newSeries.id, episodeId: null, matchMethod: 'manual', manualLock: true, updatedAt: now },
                );
            }
            return newSeries;
        });
    }

    // --- バックアップ / リストア (DBTools 用) ---
    async findAllSeries(): Promise<Series[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(Series).find();
    }
    async findAllEpisodes(): Promise<SeriesEpisode[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesEpisode).find();
    }
    async findAllLinks(): Promise<RecordedSeriesLink[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(RecordedSeriesLink).find();
    }
    async findAllAliases(): Promise<SeriesAlias[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesAlias).find();
    }
    async findAllPendingMatches(): Promise<SeriesPendingMatch[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesPendingMatch).find();
    }
    async findAllHistories(): Promise<SeriesChangeHistory[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesChangeHistory).find();
    }
    async restoreSeries(items: Series[]): Promise<void> {
        const c = await this.op.getConnection();
        const queryRunner = c.createQueryRunner();
        await queryRunner.startTransaction();
        try {
            await queryRunner.manager.createQueryBuilder().delete().from(Series).execute();
            for (const item of items) await queryRunner.manager.insert(Series, item);
            await queryRunner.commitTransaction();
        } catch (err: any) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
    async restoreEpisodes(items: SeriesEpisode[]): Promise<void> {
        const c = await this.op.getConnection();
        const queryRunner = c.createQueryRunner();
        await queryRunner.startTransaction();
        try {
            await queryRunner.manager.createQueryBuilder().delete().from(SeriesEpisode).execute();
            for (const item of items) await queryRunner.manager.insert(SeriesEpisode, item);
            await queryRunner.commitTransaction();
        } catch (err: any) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
    async restoreLinks(items: RecordedSeriesLink[]): Promise<void> {
        const c = await this.op.getConnection();
        const queryRunner = c.createQueryRunner();
        await queryRunner.startTransaction();
        try {
            await queryRunner.manager.createQueryBuilder().delete().from(RecordedSeriesLink).execute();
            for (const item of items) await queryRunner.manager.insert(RecordedSeriesLink, item);
            await queryRunner.commitTransaction();
        } catch (err: any) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
    async restoreAliases(items: SeriesAlias[]): Promise<void> {
        const c = await this.op.getConnection();
        const queryRunner = c.createQueryRunner();
        await queryRunner.startTransaction();
        try {
            await queryRunner.manager.createQueryBuilder().delete().from(SeriesAlias).execute();
            for (const item of items) await queryRunner.manager.insert(SeriesAlias, item);
            await queryRunner.commitTransaction();
        } catch (err: any) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
    async restorePendingMatches(items: SeriesPendingMatch[]): Promise<void> {
        const c = await this.op.getConnection();
        const queryRunner = c.createQueryRunner();
        await queryRunner.startTransaction();
        try {
            await queryRunner.manager.createQueryBuilder().delete().from(SeriesPendingMatch).execute();
            for (const item of items) await queryRunner.manager.insert(SeriesPendingMatch, item);
            await queryRunner.commitTransaction();
        } catch (err: any) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
    async restoreHistories(items: SeriesChangeHistory[]): Promise<void> {
        const c = await this.op.getConnection();
        const queryRunner = c.createQueryRunner();
        await queryRunner.startTransaction();
        try {
            await queryRunner.manager.createQueryBuilder().delete().from(SeriesChangeHistory).execute();
            for (const item of items) await queryRunner.manager.insert(SeriesChangeHistory, item);
            await queryRunner.commitTransaction();
        } catch (err: any) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async saveReservationHint(value: NewReservationHint): Promise<SeriesReservationHint> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(SeriesReservationHint);
        return await repo.save(repo.create(value));
    }
    async findReservationHintByReserveId(reserveId: number): Promise<SeriesReservationHint | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesReservationHint).findOne({ where: { reserveId } });
    }
    async deleteReservationHint(id: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(SeriesReservationHint).delete({ id });
    }
}
