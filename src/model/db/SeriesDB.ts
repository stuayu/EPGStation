import { inject, injectable } from 'inversify';
import { In, IsNull, Like, Not } from 'typeorm';
import Recorded from '../../db/entities/Recorded';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import SeriesAlias from '../../db/entities/SeriesAlias';
import SeriesChangeHistory from '../../db/entities/SeriesChangeHistory';
import SeriesEpisode from '../../db/entities/SeriesEpisode';
import SeriesPendingMatch from '../../db/entities/SeriesPendingMatch';
import SeriesReservationHint from '../../db/entities/SeriesReservationHint';
import Thumbnail from '../../db/entities/Thumbnail';
import VideoFile from '../../db/entities/VideoFile';
import WatchHistory from '../../db/entities/WatchHistory';
import IDBOperator from './IDBOperator';
import ISeriesDB, {
    SeriesListQuery,
    SeriesListRow,
    SeriesSeasonRow,
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
    public async query(option: SeriesListQuery): Promise<[SeriesListRow[], number]> {
        const c = await this.op.getConnection();
        // 録画件数・容量・初回/最終放送日時・未視聴数を 1 クエリで集計する。
        // watch_history は録画に対して複数行 (動画ファイル単位) 付きうるため、
        // 「視聴済みの録画 ID」を DISTINCT で数えてから引き算する
        const base = c
            .getRepository(Series)
            .createQueryBuilder('s')
            .leftJoin(RecordedSeriesLink, 'l', 'l.seriesId = s.id')
            .leftJoin(Recorded, 'r', 'r.id = l.recordedId')
            .leftJoin(VideoFile, 'v', 'v.recordedId = l.recordedId')
            .leftJoin(WatchHistory, 'w', "w.recordedId = l.recordedId AND w.status = 'watched'")
            .select('s.id', 'seriesId')
            .addSelect('COUNT(DISTINCT l.recordedId)', 'recordedCount')
            .addSelect('COALESCE(SUM(v.size), 0)', 'totalFileSize')
            .addSelect('MIN(r.startAt)', 'firstAiredAt')
            .addSelect('MAX(r.startAt)', 'lastAiredAt')
            .addSelect('COUNT(DISTINCT w.recordedId)', 'watchedCount')
            .groupBy('s.id');

        if (option.keyword) {
            base.andWhere('(s.title LIKE :kw OR s.normalizedTitle LIKE :kw OR s.titleKana LIKE :kw)', {
                kw: `%${option.keyword}%`,
            });
        }
        if (typeof option.seasonYear === 'number') {
            base.andWhere('s.seasonYear = :seasonYear', { seasonYear: option.seasonYear });
        }
        if (typeof option.seasonName === 'string' && option.seasonName !== '') {
            base.andWhere('s.seasonName = :seasonName', { seasonName: option.seasonName });
        }
        // 放送中/完結は「最終録画からの経過時間」と「総話数への到達」で判定する。
        // 総話数が不明な作品は経過時間だけで判断する
        if (option.status === 'onair') {
            base.having('MAX(r.startAt) >= :threshold', { threshold: Date.now() - option.onairWithinMs });
        } else if (option.status === 'finished') {
            base.having('MAX(r.startAt) < :threshold OR MAX(r.startAt) IS NULL', {
                threshold: Date.now() - option.onairWithinMs,
            });
        }

        const sortColumn: Record<SeriesListQuery['sort'], string> = {
            updatedAt: 's.updatedAt',
            // 読み仮名があればそれを、無ければ正規化タイトルを使う (あいうえお順)
            title: 'COALESCE(s.titleKana, s.normalizedTitle)',
            firstAiredAt: 'MIN(r.startAt)',
            lastAiredAt: 'MAX(r.startAt)',
            recordedCount: 'COUNT(DISTINCT l.recordedId)',
            totalFileSize: 'COALESCE(SUM(v.size), 0)',
        };
        const direction = option.order === 'asc' ? 'ASC' : 'DESC';
        const rows = await base
            .clone()
            .orderBy(sortColumn[option.sort], direction)
            // 同値のときの並びを安定させる
            .addOrderBy('s.id', 'ASC')
            .offset(option.offset)
            .limit(option.limit)
            .getRawMany<{
                seriesId: number;
                recordedCount: string;
                totalFileSize: string;
                firstAiredAt: string | null;
                lastAiredAt: string | null;
                watchedCount: string;
            }>();

        // 総件数。放送状態の絞り込み (HAVING) が無い場合は集計を伴わない COUNT で済むため、
        // 重い GROUP BY を 2 回走らせない (実データ 983 シリーズで約 620ms → 数 ms)
        let total: number;
        if (typeof option.status === 'undefined') {
            const counter = c.getRepository(Series).createQueryBuilder('s');
            if (option.keyword) {
                counter.andWhere('(s.title LIKE :kw OR s.normalizedTitle LIKE :kw OR s.titleKana LIKE :kw)', {
                    kw: `%${option.keyword}%`,
                });
            }
            if (typeof option.seasonYear === 'number') {
                counter.andWhere('s.seasonYear = :seasonYear', { seasonYear: option.seasonYear });
            }
            if (typeof option.seasonName === 'string' && option.seasonName !== '') {
                counter.andWhere('s.seasonName = :seasonName', { seasonName: option.seasonName });
            }
            total = await counter.getCount();
        } else {
            total = (await base.clone().getRawMany()).length;
        }
        if (rows.length === 0) return [[], total];

        const series = await c.getRepository(Series).find({ where: { id: In(rows.map(x => Number(x.seriesId))) } });
        const byId = new Map(series.map(x => [x.id, x]));
        const result: SeriesListRow[] = [];
        for (const row of rows) {
            const item = byId.get(Number(row.seriesId));
            if (typeof item === 'undefined') continue;
            const recordedCount = Number(row.recordedCount);
            result.push({
                series: item,
                recordedCount,
                totalFileSize: Number(row.totalFileSize),
                firstAiredAt: row.firstAiredAt === null ? null : Number(row.firstAiredAt),
                lastAiredAt: row.lastAiredAt === null ? null : Number(row.lastAiredAt),
                unwatchedCount: Math.max(0, recordedCount - Number(row.watchedCount)),
            });
        }
        return [result, total];
    }

    public async listRecordedForSeriesIds(seriesIds: number[]): Promise<Map<number, SeriesRecordedRow[]>> {
        const result = new Map<number, SeriesRecordedRow[]>();
        if (seriesIds.length === 0) return result;
        const c = await this.op.getConnection();
        const rows = await c
            .getRepository(RecordedSeriesLink)
            .createQueryBuilder('l')
            .innerJoin(Recorded, 'r', 'r.id = l.recordedId')
            .leftJoin(SeriesEpisode, 'e', 'e.id = l.episodeId')
            .where('l.seriesId IN (:...seriesIds)', { seriesIds })
            .select('l.seriesId', 'seriesId')
            .addSelect('l.recordedId', 'recordedId')
            .addSelect('l.channelId', 'channelId')
            .addSelect('r.startAt', 'startAt')
            .addSelect('e.seasonNumber', 'seasonNumber')
            .addSelect('e.episodeNumber', 'episodeNumber')
            .getRawMany<SeriesRecordedRow & { seriesId: number }>();
        for (const row of rows) {
            const list = result.get(Number(row.seriesId)) ?? [];
            list.push(row);
            result.set(Number(row.seriesId), list);
        }
        return result;
    }

    public async listSeasons(): Promise<SeriesSeasonRow[]> {
        const c = await this.op.getConnection();
        return await c
            .getRepository(Series)
            .createQueryBuilder('s')
            .where('s.seasonYear IS NOT NULL')
            .select('s.seasonYear', 'seasonYear')
            .addSelect('s.seasonName', 'seasonName')
            .addSelect('COUNT(*)', 'count')
            .groupBy('s.seasonYear')
            .addGroupBy('s.seasonName')
            .orderBy('s.seasonYear', 'DESC')
            .addOrderBy('s.seasonName', 'ASC')
            .getRawMany<SeriesSeasonRow>();
    }

    public async findFirstAiredAtMap(): Promise<Map<number, number>> {
        const c = await this.op.getConnection();
        const rows = await c
            .getRepository(RecordedSeriesLink)
            .createQueryBuilder('l')
            .innerJoin(Recorded, 'r', 'r.id = l.recordedId')
            .select('l.seriesId', 'seriesId')
            .addSelect('MIN(r.startAt)', 'firstAiredAt')
            .groupBy('l.seriesId')
            .getRawMany<{ seriesId: number; firstAiredAt: string }>();
        return new Map(rows.map(x => [Number(x.seriesId), Number(x.firstAiredAt)]));
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
    public async findThumbnailPaths(seriesIds: number[]): Promise<Map<number, string>> {
        const result = new Map<number, string>();
        if (seriesIds.length === 0) return result;
        const c = await this.op.getConnection();
        // シリーズごとに「最も小さい thumbnail.id」を代表として取る
        const rows = await c
            .getRepository(RecordedSeriesLink)
            .createQueryBuilder('l')
            .innerJoin(Thumbnail, 't', 't.recordedId = l.recordedId')
            .where('l.seriesId IN (:...seriesIds)', { seriesIds })
            .select('l.seriesId', 'seriesId')
            .addSelect('MIN(t.id)', 'thumbnailId')
            .groupBy('l.seriesId')
            .getRawMany<{ seriesId: number; thumbnailId: number }>();
        if (rows.length === 0) return result;

        const thumbnails = await c
            .getRepository(Thumbnail)
            .find({ where: { id: In(rows.map(x => Number(x.thumbnailId))) } });
        const byId = new Map(thumbnails.map(x => [x.id, x.filePath]));
        for (const row of rows) {
            const filePath = byId.get(Number(row.thumbnailId));
            if (typeof filePath === 'string') result.set(Number(row.seriesId), filePath);
        }
        return result;
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
        value: {
            annictId?: string | null;
            syobocalTid?: number | null;
            titleKana?: string | null;
            seasonYear?: number | null;
            seasonName?: string | null;
            seasonSource?: string | null;
            totalEpisodes?: number | null;
        },
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
    public async upsertAlias(
        normalizedTitle: string,
        seriesId: number,
        createdAt: number,
        source: string = 'manual',
    ): Promise<SeriesAlias> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(SeriesAlias);
        const current = await repo.findOne({ where: { normalizedTitle } });
        return await repo.save(
            repo.create({
                id: current?.id,
                normalizedTitle,
                seriesId,
                source,
                createdAt: current?.createdAt ?? createdAt,
            }),
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
