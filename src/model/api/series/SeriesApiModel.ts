import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import { analyzeSeriesContinuity } from '../../series/SeriesContinuity';
import { getSeriesOrigin } from '../../series/SeriesOrigin';
import * as apid from '../../../../api';
import ISeriesApiModel, { SeriesDetail, SeriesListOption, SeriesListResult } from './ISeriesApiModel';
import ISeriesImageModel from './ISeriesImageModel';
@injectable()
export default class SeriesApiModel implements ISeriesApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('ISeriesImageModel') private imageModel: ISeriesImageModel,
    ) {}
    // 最終録画からこの期間内なら「放送中」とみなす
    private static readonly ON_AIR_WITHIN_MS = 45 * 24 * 60 * 60 * 1000;

    public async list(option: SeriesListOption): Promise<SeriesListResult> {
        this.enabled();
        const limit = Math.min(100, Math.max(1, option.limit));
        const offset = Math.max(0, option.offset);
        // 欠番での絞り込みは SQL で表現できない (話数の連続性を JS 側で判定するため)。
        // その場合だけ全件を取得してから絞り込み、ページングし直す
        const needsAllRows = option.hasMissing === true;
        const [rows, total] = await this.db.query({
            keyword: option.keyword?.trim() || undefined,
            offset: needsAllRows ? 0 : offset,
            limit: needsAllRows ? Number.MAX_SAFE_INTEGER : limit,
            sort: option.sort ?? 'updatedAt',
            order: option.order ?? 'desc',
            seasonYear: option.seasonYear,
            seasonName: option.seasonName,
            status: option.status,
            origin: option.origin,
            onairWithinMs: SeriesApiModel.ON_AIR_WITHIN_MS,
        });

        // 欠番・重複は話数の連続性から判定する。ページ分の録画行を 1 クエリでまとめて取る
        const recordedRows = await this.db.listRecordedForSeriesIds(rows.map(x => x.series.id)).catch(() => new Map());
        const now = Date.now();
        let items = rows.map(row => {
            const continuity = analyzeSeriesContinuity(recordedRows.get(row.series.id) ?? [], {
                totalEpisodesBySeason: row.series.totalEpisodes === null ? undefined : { 1: row.series.totalEpisodes },
                now,
            });
            return {
                row,
                missingEpisodeCount: continuity.missingEpisodes.length,
                duplicateEpisodeCount: continuity.duplicateEpisodes.length,
            };
        });
        let filteredTotal = total;
        if (needsAllRows === true) {
            items = items.filter(x => x.missingEpisodeCount > 0);
            filteredTotal = items.length;
            items = items.slice(offset, offset + limit);
        }

        // アイキャッチ画像の有無をまとめて解決する (画像の実体は GET /api/series/{id}/image が返す)
        const images = await this.imageModel.getInfoMap(items.map(x => x.row.series.id)).catch(() => new Map());
        return {
            items: items.map(({ row, missingEpisodeCount, duplicateEpisodeCount }) => {
                const series = row.series;
                const image = images.get(series.id);
                return {
                    id: series.id,
                    title: series.title,
                    normalizedTitle: series.normalizedTitle,
                    mediaType: series.mediaType,
                    preferredChannelId: series.preferredChannelId,
                    updatedAt: Number(series.updatedAt),
                    titleKana: series.titleKana,
                    seasonYear: series.seasonYear,
                    seasonName: (series.seasonName ?? null) as apid.SeriesListItem['seasonName'],
                    seasonSource: (series.seasonSource ?? null) as apid.SeriesListItem['seasonSource'],
                    titleSource: (series.titleSource ?? null) as apid.SeriesListItem['titleSource'],
                    recordedCount: row.recordedCount,
                    totalFileSize: row.totalFileSize,
                    firstAiredAt: row.firstAiredAt,
                    lastAiredAt: row.lastAiredAt,
                    unwatchedCount: row.unwatchedCount,
                    totalEpisodes: series.totalEpisodes,
                    missingEpisodeCount,
                    duplicateEpisodeCount,
                    isOnAir: row.lastAiredAt !== null && now - row.lastAiredAt <= SeriesApiModel.ON_AIR_WITHIN_MS,
                    hasImage: typeof image !== 'undefined',
                    imageSource: image?.source ?? null,
                    imageCopyright: image?.copyright ?? null,
                    origin: getSeriesOrigin(series),
                };
            }),
            total: filteredTotal,
        };
    }

    public async listSeasons(): Promise<apid.SeriesSeasonItem[]> {
        this.enabled();
        return (await this.db.listSeasons()).map(x => ({
            seasonYear: Number(x.seasonYear),
            seasonName: x.seasonName,
            count: Number(x.count),
        }));
    }
    async get(id: number, channelId?: number): Promise<SeriesDetail | null> {
        this.enabled();
        const series = await this.db.getSeries(id);
        if (!series) return null;
        const [recorded, channels, allRecorded] = await Promise.all([
            this.db.listRecorded(id, channelId),
            this.db.listChannels(id),
            typeof channelId === 'number' ? this.db.listRecorded(id) : Promise.resolve(null),
        ]);
        const image = await this.imageModel.getInfo(id).catch(() => null);
        // 一覧と同じ集計値を詳細でも返す (SeriesDetail は SeriesListItem を継承している)
        const summary = (await this.db.listRecordedForSeriesIds([id])).get(id) ?? [];
        const continuity = analyzeSeriesContinuity(summary, {
            totalEpisodesBySeason: series.totalEpisodes === null ? undefined : { 1: series.totalEpisodes },
            now: Date.now(),
        });
        const lastAiredAt = summary.length === 0 ? null : Math.max(...summary.map(x => Number(x.startAt)));
        return {
            id: series.id,
            titleKana: series.titleKana,
            seasonYear: series.seasonYear,
            seasonName: (series.seasonName ?? null) as apid.SeriesListItem['seasonName'],
            seasonSource: (series.seasonSource ?? null) as apid.SeriesListItem['seasonSource'],
            titleSource: (series.titleSource ?? null) as apid.SeriesListItem['titleSource'],
            recordedCount: summary.length,
            totalFileSize: 0,
            firstAiredAt: summary.length === 0 ? null : Math.min(...summary.map(x => Number(x.startAt))),
            lastAiredAt,
            unwatchedCount: 0,
            totalEpisodes: series.totalEpisodes,
            missingEpisodeCount: continuity.missingEpisodes.length,
            duplicateEpisodeCount: continuity.duplicateEpisodes.length,
            isOnAir: lastAiredAt !== null && Date.now() - lastAiredAt <= SeriesApiModel.ON_AIR_WITHIN_MS,
            title: series.title,
            normalizedTitle: series.normalizedTitle,
            mediaType: series.mediaType,
            preferredChannelId: series.preferredChannelId,
            updatedAt: Number(series.updatedAt),
            hasImage: image !== null,
            imageSource: image?.source ?? null,
            imageCopyright: image?.copyright ?? null,
            origin: getSeriesOrigin(series),
            comment: series.comment ?? null,
            commentSource: (series.commentSource ?? null) as apid.SeriesDetail['commentSource'],
            externalIds: {
                syobocalTid: series.syobocalTid,
                annictId: series.annictId,
                wikidataQid: series.wikidataQid ?? null,
                tmdbId: series.tmdbId,
            },
            channels: channels.map(x => ({ ...x, count: Number(x.count) })),
            continuity: analyzeSeriesContinuity(allRecorded ?? recorded),
            recorded: recorded.map(x => ({
                ...x,
                recordedId: Number(x.recordedId),
                channelId: Number(x.channelId),
                startAt: Number(x.startAt),
                endAt: Number(x.endAt),
                episodeId: x.episodeId === null ? null : Number(x.episodeId),
                seasonNumber: x.seasonNumber === null ? null : Number(x.seasonNumber),
                episodeNumber: x.episodeNumber === null ? null : Number(x.episodeNumber),
                episodeCommentSource: (x.episodeCommentSource ??
                    null) as apid.SeriesRecordedRow['episodeCommentSource'],
                confidence: Number(x.confidence),
            })),
        };
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
