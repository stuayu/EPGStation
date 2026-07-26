import { inject, injectable } from 'inversify';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import IAppSettingDB from '../db/IAppSettingDB';
import ISeriesDB from '../db/ISeriesDB';
import ISeriesResolver, { SeriesRecordingInput } from './ISeriesResolver';
import { parseSeriesInfo } from './SeriesNormalizer';
export function titleSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const pairs = (s: string) => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
    const right = pairs(b);
    let hits = 0;
    for (const pair of pairs(a)) {
        const i = right.indexOf(pair);
        if (i >= 0) {
            hits++;
            right.splice(i, 1);
        }
    }
    return (2 * hits) / (a.length + b.length - 2);
}
@injectable()
export default class SeriesResolver implements ISeriesResolver {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISeriesDB') private db: ISeriesDB,
    ) {}
    async resolve(recording: SeriesRecordingInput): Promise<RecordedSeriesLink | null> {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary')) return null;
        const existing = await this.db.findLink(recording.recordedId);
        if (existing?.manualLock) return existing;
        const parsed = parseSeriesInfo(recording.title);
        if (!parsed.normalizedTitle) return null;
        const candidates = await this.db.findCandidates(parsed.normalizedTitle);
        const settings = await this.settings.getAll();
        const threshold = this.threshold((settings.series as any)?.matchThreshold);
        let winner: Series | null = null;
        let confidence = 0;
        for (const candidate of candidates) {
            const score = Math.min(
                1,
                titleSimilarity(parsed.normalizedTitle, candidate.normalizedTitle) * 0.9 +
                    (candidate.preferredChannelId === recording.channelId ? 0.08 : 0),
            );
            if (score > confidence) {
                winner = candidate;
                confidence = score;
            }
        }
        const now = Date.now();
        if (!winner || confidence < threshold) {
            winner = await this.db.createSeries({
                title: recording.title,
                normalizedTitle: parsed.normalizedTitle,
                preferredChannelId: recording.channelId,
                createdAt: now,
                updatedAt: now,
            });
            confidence = 1;
        }
        let episode = null;
        if (parsed.episodeNumber !== null) {
            episode = await this.db.findEpisode(winner.id, parsed.seasonNumber, parsed.episodeNumber);
            if (!episode)
                episode = await this.db.createEpisode({
                    seriesId: winner.id,
                    seasonNumber: parsed.seasonNumber,
                    episodeNumber: parsed.episodeNumber,
                    episodeLabel: parsed.episodeLabel,
                    title: null,
                    airedAt: recording.startAt,
                    createdAt: now,
                    updatedAt: now,
                });
        }
        let airType = parsed.airType;
        if (airType === 'unknown' && episode)
            airType =
                (await this.db.countOtherLinksByEpisode(episode.id, recording.recordedId)) > 0 ? 'rerun' : 'first';
        return await this.db.saveLink({
            recordedId: recording.recordedId,
            seriesId: winner.id,
            episodeId: episode?.id ?? null,
            airType,
            matchMethod: 'title',
            confidence,
            manualLock: false,
            createdAt: now,
            updatedAt: now,
        });
    }
    private threshold(value: unknown): number {
        return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
    }
}
