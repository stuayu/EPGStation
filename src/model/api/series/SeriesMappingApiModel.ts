import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IRecordedDB from '../../db/IRecordedDB';
import ISeriesDB from '../../db/ISeriesDB';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import ISeriesMappingApiModel, { SeriesMappingValue, UpdateSeriesMappingOption } from './ISeriesMappingApiModel';
@injectable()
export default class SeriesMappingApiModel implements ISeriesMappingApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
    ) {}
    async get(recordedId: number): Promise<SeriesMappingValue | null> {
        this.enabled();
        const link = await this.seriesDB.findLink(recordedId);
        if (!link) return null;
        const [recorded, series, episode] = await Promise.all([
            this.recordedDB.findId(recordedId),
            this.seriesDB.getSeries(link.seriesId),
            link.episodeId === null ? Promise.resolve(null) : this.seriesDB.findEpisodeById(link.episodeId),
        ]);
        if (!recorded || !series) return null;
        return {
            recordedId,
            recordedTitle: recorded.name,
            seriesId: series.id,
            seriesTitle: series.title,
            episodeId: episode?.id ?? null,
            seasonNumber: episode?.seasonNumber ?? null,
            episodeNumber: episode?.episodeNumber ?? null,
            airType: link.airType,
            matchMethod: link.matchMethod,
            confidence: link.confidence,
            manualLock: link.manualLock,
        };
    }
    async update(recordedId: number, option: UpdateSeriesMappingOption): Promise<SeriesMappingValue> {
        this.enabled();
        const recorded = await this.recordedDB.findId(recordedId);
        if (!recorded) throw new Error('RecordedIsNotFound');
        let series = typeof option.seriesId === 'number' ? await this.seriesDB.getSeries(option.seriesId) : null;
        const now = Date.now();
        if (!series && typeof option.seriesTitle === 'string' && option.seriesTitle.trim()) {
            const title = option.seriesTitle.trim();
            series = await this.seriesDB.createSeries({
                title,
                normalizedTitle: normalizeSeriesTitle(title),
                preferredChannelId: recorded.channelId,
                createdAt: now,
                updatedAt: now,
            });
        }
        if (!series) throw new Error('SeriesIsNotFound');
        const season = this.integer(option.seasonNumber ?? 1, 'seasonNumber', 1);
        const number = this.episode(option.episodeNumber);
        let episode = null;
        if (number !== null) {
            episode = await this.seriesDB.findEpisode(series.id, season, number);
            if (!episode)
                episode = await this.seriesDB.createEpisode({
                    seriesId: series.id,
                    seasonNumber: season,
                    episodeNumber: number,
                    episodeLabel: `第${number}話`,
                    title: null,
                    airedAt: recorded.startAt,
                    createdAt: now,
                    updatedAt: now,
                });
        }
        const airType = this.airType(option.airType);
        await this.seriesDB.saveLink({
            recordedId,
            seriesId: series.id,
            episodeId: episode?.id ?? null,
            airType,
            matchMethod: 'manual',
            confidence: 1,
            manualLock: true,
            createdAt: now,
            updatedAt: now,
        });
        const result = await this.get(recordedId);
        if (!result) throw new Error('SeriesMappingSaveFailed');
        return result;
    }
    async remove(recordedId: number): Promise<void> {
        this.enabled();
        await this.seriesDB.deleteLink(recordedId);
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
    private integer(value: unknown, name: string, min: number): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min) throw new Error(`Invalid${name}`);
        return value;
    }
    private episode(value: unknown): number | null {
        if (value === null || typeof value === 'undefined') return null;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('InvalidEpisodeNumber');
        return value;
    }
    private airType(value: unknown): 'first' | 'rerun' | 'delayed' | 'unknown' {
        return value === 'first' || value === 'rerun' || value === 'delayed' || value === 'unknown' ? value : 'unknown';
    }
}
