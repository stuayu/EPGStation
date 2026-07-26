import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import { analyzeSeriesContinuity } from '../../series/SeriesContinuity';
import ISeriesApiModel, { SeriesDetail, SeriesListResult } from './ISeriesApiModel';
@injectable()
export default class SeriesApiModel implements ISeriesApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
    ) {}
    async list(keyword: string | undefined, offset: number, limit: number): Promise<SeriesListResult> {
        this.enabled();
        const safeLimit = Math.min(100, Math.max(1, limit));
        const safeOffset = Math.max(0, offset);
        const [items, total] = await this.db.list(keyword?.trim() || undefined, safeOffset, safeLimit);
        return {
            items: items.map(x => ({
                id: x.id,
                title: x.title,
                normalizedTitle: x.normalizedTitle,
                mediaType: x.mediaType,
                preferredChannelId: x.preferredChannelId,
                updatedAt: Number(x.updatedAt),
            })),
            total,
        };
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
        return {
            id: series.id,
            title: series.title,
            normalizedTitle: series.normalizedTitle,
            mediaType: series.mediaType,
            preferredChannelId: series.preferredChannelId,
            updatedAt: Number(series.updatedAt),
            externalIds: { syobocalTid: series.syobocalTid, annictId: series.annictId, tmdbId: series.tmdbId },
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
                confidence: Number(x.confidence),
            })),
        };
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
