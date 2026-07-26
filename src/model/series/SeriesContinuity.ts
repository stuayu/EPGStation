import { SeriesRecordedRow } from '../db/ISeriesDB';
export interface SeriesContinuity {
    missingEpisodes: Array<{ seasonNumber: number; episodeNumber: number }>;
    duplicateEpisodes: Array<{
        seasonNumber: number;
        episodeNumber: number;
        recordedIds: number[];
        channelIds: number[];
    }>;
    unknownEpisodeRecordedIds: number[];
}
export function analyzeSeriesContinuity(rows: SeriesRecordedRow[]): SeriesContinuity {
    const groups = new Map<string, SeriesRecordedRow[]>(),
        seasons = new Map<number, Set<number>>();
    const unknown: number[] = [];
    for (const row of rows) {
        const season = Number(row.seasonNumber ?? 1),
            ep = row.episodeNumber === null ? null : Number(row.episodeNumber);
        if (ep === null || !Number.isFinite(ep)) {
            unknown.push(Number(row.recordedId));
            continue;
        }
        const key = `${season}:${ep}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
        if (Number.isInteger(ep) && ep >= 1) {
            const set = seasons.get(season) ?? new Set<number>();
            set.add(ep);
            seasons.set(season, set);
        }
    }
    const missing = [] as Array<{ seasonNumber: number; episodeNumber: number }>;
    for (const [season, set] of seasons) {
        const max = Math.max(...set);
        for (let n = 1; n <= max; n++) if (!set.has(n)) missing.push({ seasonNumber: season, episodeNumber: n });
    }
    const duplicateEpisodes = [] as SeriesContinuity['duplicateEpisodes'];
    for (const [key, items] of groups) {
        if (items.length < 2) continue;
        const [seasonNumber, episodeNumber] = key.split(':').map(Number);
        duplicateEpisodes.push({
            seasonNumber,
            episodeNumber,
            recordedIds: items.map(x => Number(x.recordedId)),
            channelIds: [...new Set(items.map(x => Number(x.channelId)))],
        });
    }
    const sort = (
        a: { seasonNumber: number; episodeNumber: number },
        b: { seasonNumber: number; episodeNumber: number },
    ) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber;
    return {
        missingEpisodes: missing.sort(sort),
        duplicateEpisodes: duplicateEpisodes.sort(sort),
        unknownEpisodeRecordedIds: unknown,
    };
}
