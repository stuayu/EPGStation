import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IProgramDB from '../../db/IProgramDB';
import IProgramSeriesDB from '../../db/IProgramSeriesDB';
import ISeriesDB from '../../db/ISeriesDB';
import { parseSeriesInfo } from '../../series/SeriesNormalizer';
import { titleSimilarity } from '../../series/SeriesResolver';
import IProgramSeriesApiModel, { ProgramSeriesResult } from './IProgramSeriesApiModel';
@injectable()
export default class ProgramSeriesApiModel implements IProgramSeriesApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IProgramDB') private programs: IProgramDB,
        @inject('IProgramSeriesDB') private links: IProgramSeriesDB,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
    ) {}
    public async get(programId: number): Promise<ProgramSeriesResult | null> {
        const config = this.config.getConfig();
        if (!isFeatureEnabled(config, 'seriesLibrary') || !isFeatureEnabled(config, 'programSeriesMapping'))
            throw new Error('ProgramSeriesMappingFeatureIsDisabled');
        const current = await this.links.get(programId);
        if (current) return this.result(current);
        const program = await this.programs.findId(programId);
        if (!program) return null;
        const parsed = parseSeriesInfo(program.name);
        if (!parsed.normalizedTitle) return null;
        const candidates = await this.seriesDB.findCandidates(parsed.normalizedTitle);
        let series =
            candidates.sort(
                (a, b) =>
                    titleSimilarity(parsed.normalizedTitle, b.normalizedTitle) -
                    titleSimilarity(parsed.normalizedTitle, a.normalizedTitle),
            )[0] ?? null;
        const confidence = series ? titleSimilarity(parsed.normalizedTitle, series.normalizedTitle) : 1;
        const now = Date.now();
        if (!series)
            series = await this.seriesDB.createSeries({
                title: program.name,
                normalizedTitle: parsed.normalizedTitle,
                preferredChannelId: program.channelId,
                createdAt: now,
                updatedAt: now,
            });
        let episode = null;
        if (parsed.episodeNumber !== null) {
            episode = await this.seriesDB.findEpisode(series.id, parsed.seasonNumber, parsed.episodeNumber);
            if (!episode)
                episode = await this.seriesDB.createEpisode({
                    seriesId: series.id,
                    seasonNumber: parsed.seasonNumber,
                    episodeNumber: parsed.episodeNumber,
                    episodeLabel: parsed.episodeLabel,
                    title: null,
                    airedAt: program.startAt,
                    createdAt: now,
                    updatedAt: now,
                });
        }
        return this.result(
            await this.links.save({
                programId,
                seriesId: series.id,
                episodeId: episode?.id ?? null,
                confidence,
                source: 'epg',
                manualLock: false,
                updatedAt: now,
            }),
        );
    }
    private result(x: {
        programId: number;
        seriesId: number;
        episodeId: number | null;
        confidence: number;
        source: string;
    }): ProgramSeriesResult {
        return {
            programId: Number(x.programId),
            seriesId: Number(x.seriesId),
            episodeId: x.episodeId === null ? null : Number(x.episodeId),
            confidence: Number(x.confidence),
            source: x.source,
        };
    }
}
