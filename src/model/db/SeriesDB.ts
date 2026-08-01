import { inject, injectable } from 'inversify';
import { In, IsNull, Like, Not, SelectQueryBuilder } from 'typeorm';
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
    EmptySeriesRow,
    SeriesListQuery,
    SeriesListRow,
    SeriesSeasonRow,
    NewEpisode,
    NewHistory,
    NewPendingMatch,
    NewReservationHint,
    NewSeries,
    PendingCandidate,
    RecordedSeriesInfo,
    SaveSeriesLink,
    SeriesChannelRow,
    SeriesRecordedRow,
} from './ISeriesDB';
@injectable()
export default class SeriesDB implements ISeriesDB {
    // IN 句のバインド変数上限 (SQLite は既定 999) を超えないように分割する単位
    private static readonly DELETE_CHUNK_SIZE = 200;

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
    public async findByWikidataQid(wikidataQid: string): Promise<Series | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(Series).findOne({ where: { wikidataQid } });
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
    public async findSeriesInfoByRecordedIds(recordedIds: number[]): Promise<Map<number, RecordedSeriesInfo>> {
        const result = new Map<number, RecordedSeriesInfo>();
        if (recordedIds.length === 0) return result;
        const c = await this.op.getConnection();

        // IN 句のバインド変数上限 (SQLite は既定 999) を超えないように分割して引く
        for (let i = 0; i < recordedIds.length; i += SeriesDB.DELETE_CHUNK_SIZE) {
            const chunk = recordedIds.slice(i, i + SeriesDB.DELETE_CHUNK_SIZE);
            const rows = await c
                .getRepository(RecordedSeriesLink)
                .createQueryBuilder('l')
                .innerJoin(Series, 's', 's.id = l.seriesId')
                .leftJoin(SeriesEpisode, 'e', 'e.id = l.episodeId')
                .where('l.recordedId IN (:...recordedIds)', { recordedIds: chunk })
                .select('l.recordedId', 'recordedId')
                .addSelect('l.seriesId', 'seriesId')
                .addSelect('s.title', 'seriesTitle')
                .addSelect('e.seasonNumber', 'seasonNumber')
                .addSelect('e.episodeNumber', 'episodeNumber')
                .addSelect('e.episodeLabel', 'episodeLabel')
                .addSelect('e.title', 'episodeTitle')
                .addSelect('e.comment', 'episodeComment')
                .addSelect('e.commentSource', 'episodeCommentSource')
                .addSelect('l.airType', 'airType')
                .getRawMany<RecordedSeriesInfo & { recordedId: number }>();
            for (const row of rows) {
                result.set(Number(row.recordedId), {
                    seriesId: Number(row.seriesId),
                    seriesTitle: row.seriesTitle,
                    seasonNumber: row.seasonNumber === null ? null : Number(row.seasonNumber),
                    episodeNumber: row.episodeNumber === null ? null : Number(row.episodeNumber),
                    episodeLabel: row.episodeLabel ?? null,
                    episodeTitle: row.episodeTitle ?? null,
                    episodeComment: row.episodeComment ?? null,
                    episodeCommentSource: row.episodeCommentSource ?? null,
                    airType: row.airType,
                });
            }
        }
        return result;
    }
    public async fillEpisodeMetadata(
        episodeId: number,
        value: { title?: string | null; comment?: string | null },
        updatedAt: number,
    ): Promise<void> {
        const c = await this.op.getConnection();
        // 手動で付け直した値を自動補完で上書きしないため、未設定の項目だけを対象にする
        if (typeof value.title === 'string') {
            await c
                .createQueryBuilder()
                .update(SeriesEpisode)
                .set({ title: value.title, updatedAt })
                .where('id = :id', { id: episodeId })
                .andWhere('title IS NULL')
                .execute();
        }
        if (typeof value.comment === 'string') {
            await c
                .createQueryBuilder()
                .update(SeriesEpisode)
                .set({ comment: value.comment, commentSource: 'dictionary', updatedAt })
                .where('id = :id', { id: episodeId })
                .andWhere('comment IS NULL')
                .execute();
        }
    }
    public async updateEpisodeComment(episodeId: number, comment: string | null, updatedAt: number): Promise<boolean> {
        const c = await this.op.getConnection();
        const result = await c
            .createQueryBuilder()
            .update(SeriesEpisode)
            // 手動設定は出所を manual にして以後の自動補完から守る。削除 (null) の場合も同様に
            // manual を残し、次の同期で辞書の値が戻ってこないようにする
            .set({ comment, commentSource: 'manual', updatedAt })
            .where('id = :id', { id: episodeId })
            .execute();

        return (result.affected ?? 0) > 0;
    }
    public async updateSeriesComment(
        seriesId: number,
        comment: string | null,
        source: 'dictionary' | 'manual',
        updatedAt: number,
    ): Promise<boolean> {
        const c = await this.op.getConnection();
        const result = await c
            .createQueryBuilder()
            .update(Series)
            .set({ comment, commentSource: source, updatedAt })
            .where('id = :id', { id: seriesId })
            .execute();

        return (result.affected ?? 0) > 0;
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
    public async findByNormalizedTitlePrefix(
        prefix: string,
        limit: number,
        excludeSeriesId?: number,
    ): Promise<Series[]> {
        if (prefix === '') return [];
        const c = await this.op.getConnection();
        const qb = c
            .getRepository(Series)
            .createQueryBuilder('s')
            // LIKE のワイルドカードはタイトルに含まれうるためエスケープする
            .where("s.normalizedTitle LIKE :prefix ESCAPE '\\\\'", { prefix: `${SeriesDB.escapeLike(prefix)}%` });
        if (typeof excludeSeriesId === 'number') qb.andWhere('s.id <> :excludeSeriesId', { excludeSeriesId });
        return await qb.orderBy('s.normalizedTitle', 'ASC').limit(limit).getMany();
    }

    /**
     * LIKE のパターン文字 (% _ \) をエスケープする
     */
    private static escapeLike(value: string): string {
        return value.replace(/[\\%_]/g, x => `\\${x}`);
    }

    /**
     * 一覧と総件数で共通の絞り込み条件 (集計を伴わないもの) を適用する。
     * 一覧側と件数側で条件がずれると total が合わなくなるため 1 箇所にまとめている
     */
    private static applyListWhere(qb: SelectQueryBuilder<Series>, option: SeriesListQuery): void {
        if (option.keyword) {
            qb.andWhere('(s.title LIKE :kw OR s.normalizedTitle LIKE :kw OR s.titleKana LIKE :kw)', {
                kw: `%${option.keyword}%`,
            });
        }
        if (typeof option.seasonYear === 'number') {
            qb.andWhere('s.seasonYear = :seasonYear', { seasonYear: option.seasonYear });
        }
        if (typeof option.seasonName === 'string' && option.seasonName !== '') {
            qb.andWhere('s.seasonName = :seasonName', { seasonName: option.seasonName });
        }
        // 外部の作品辞書 (しょぼいカレンダー / Annict / Wikidata) の ID を 1 つでも持つものを「辞書起点」とみなす
        const externalIds = '(s.syobocalTid IS NOT NULL OR s.annictId IS NOT NULL OR s.wikidataQid IS NOT NULL)';
        if (option.origin === 'dictionary') {
            qb.andWhere(externalIds);
        } else if (option.origin === 'local') {
            qb.andWhere(`NOT ${externalIds}`);
        }
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

        SeriesDB.applyListWhere(base, option);
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
            SeriesDB.applyListWhere(counter, option);
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
            .addSelect('e.comment', 'episodeComment')
            .addSelect('e.commentSource', 'episodeCommentSource')
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
            title?: string;
            titleSource?: string | null;
            annictId?: string | null;
            syobocalTid?: number | null;
            wikidataQid?: string | null;
            tmdbId?: number | null;
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
    public async getAlias(id: number): Promise<SeriesAlias | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(SeriesAlias).findOne({ where: { id } });
    }
    public async updateAlias(id: number, seriesId: number, source: string): Promise<SeriesAlias> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(SeriesAlias);
        const current = await repo.findOne({ where: { id } });
        if (current === null) throw new Error('SeriesAliasIsNotFound');
        // 正規化タイトルは辞書の引き当てキーなので変更しない (別の表記を足したい場合は新規登録する)
        return await repo.save(repo.create({ ...current, seriesId, source }));
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
                await linkRepo.update(
                    { id: link.id },
                    { seriesId: toSeriesId, episodeId: newEpisodeId, updatedAt: Date.now() },
                );
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
                    {
                        seriesId: newSeries.id,
                        episodeId: null,
                        matchMethod: 'manual',
                        manualLock: true,
                        updatedAt: now,
                    },
                );
            }
            return newSeries;
        });
    }

    /**
     * 録画が 1 件も紐づいていないシリーズを列挙する
     * @return Promise<EmptySeriesRow[]> 更新日時の新しい順
     */
    public async listEmptySeries(): Promise<EmptySeriesRow[]> {
        const c = await this.op.getConnection();
        const series = await c
            .getRepository(Series)
            .createQueryBuilder('s')
            .leftJoin(RecordedSeriesLink, 'l', 'l.seriesId = s.id')
            .where('l.id IS NULL')
            .orderBy('s.updatedAt', 'DESC')
            .getMany();
        if (series.length === 0) return [];

        const ids = series.map(s => s.id);
        const aliasCounts = await this.countBySeriesId(SeriesAlias, ids);
        const episodeCounts = await this.countBySeriesId(SeriesEpisode, ids);

        return series.map(s => {
            return {
                series: s,
                aliasCount: aliasCounts.get(s.id) ?? 0,
                episodeCount: episodeCounts.get(s.id) ?? 0,
            };
        });
    }

    /**
     * seriesId ごとの行数を数える (SQLite のバインド変数上限を避けるため分割して問い合わせる)
     * @param entity: 対象エンティティ (seriesId 列を持つこと)
     * @param ids: number[] シリーズ ID
     * @return Promise<Map<number, number>> seriesId -> 件数
     */
    private async countBySeriesId(entity: any, ids: number[]): Promise<Map<number, number>> {
        const c = await this.op.getConnection();
        const result = new Map<number, number>();
        for (let i = 0; i < ids.length; i += SeriesDB.DELETE_CHUNK_SIZE) {
            const chunk = ids.slice(i, i + SeriesDB.DELETE_CHUNK_SIZE);
            const rows = await c
                .getRepository(entity)
                .createQueryBuilder('t')
                .select('t.seriesId', 'seriesId')
                .addSelect('COUNT(*)', 'cnt')
                .where('t.seriesId IN (:...ids)', { ids: chunk })
                .groupBy('t.seriesId')
                .getRawMany();
            for (const row of rows) {
                result.set(Number(row.seriesId), Number(row.cnt));
            }
        }
        return result;
    }

    /**
     * シリーズを関連レコードごと削除する。録画が紐づいているシリーズは削除しない
     * @param ids: number[] 削除対象のシリーズ ID
     * @return Promise<number> 実際に削除したシリーズ数
     */
    public async deleteSeriesByIds(ids: number[]): Promise<number> {
        if (ids.length === 0) return 0;
        const c = await this.op.getConnection();
        return await c.transaction(async manager => {
            const linkRepo = manager.getRepository(RecordedSeriesLink);
            const seriesRepo = manager.getRepository(Series);
            let deleted = 0;
            for (let i = 0; i < ids.length; i += SeriesDB.DELETE_CHUNK_SIZE) {
                const chunk = ids.slice(i, i + SeriesDB.DELETE_CHUNK_SIZE);
                // 並行して録画が紐づいたシリーズは対象外にする
                const links = await linkRepo.find({ where: { seriesId: In(chunk) } });
                const used = new Set(links.map(l => l.seriesId));
                const targets = chunk.filter(id => used.has(id) === false);
                if (targets.length === 0) continue;
                await manager.getRepository(SeriesEpisode).delete({ seriesId: In(targets) });
                await manager.getRepository(SeriesAlias).delete({ seriesId: In(targets) });
                await manager.getRepository(SeriesReservationHint).delete({ seriesId: In(targets) });
                const result = await seriesRepo.delete({ id: In(targets) });
                deleted += typeof result.affected === 'number' ? result.affected : targets.length;
            }
            return deleted;
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
