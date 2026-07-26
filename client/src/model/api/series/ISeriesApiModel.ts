export interface SeriesListItem {
    id: number;
    title: string;
    normalizedTitle: string;
    mediaType: string;
    preferredChannelId: number | null;
    updatedAt: number;
}
export interface SeriesListResult {
    items: SeriesListItem[];
    total: number;
}
export interface SeriesChannel {
    channelId: number;
    channelName: string | null;
    count: number;
}
export interface SeriesRecording {
    recordedId: number;
    channelId: number;
    channelName: string | null;
    recordedTitle: string;
    startAt: number;
    endAt: number;
    episodeId: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    episodeLabel: string | null;
    episodeTitle: string | null;
    airType: string;
    confidence: number;
}
export interface SeriesDetail extends SeriesListItem {
    channels: SeriesChannel[];
    continuity: {
        missingEpisodes: Array<{ seasonNumber: number; episodeNumber: number }>;
        duplicateEpisodes: Array<{ seasonNumber: number; episodeNumber: number; recordedIds: number[]; channelIds: number[] }>;
        unknownEpisodeRecordedIds: number[];
    };
    recorded: SeriesRecording[];
    externalIds: { syobocalTid: number | null; annictId: string | null; tmdbId: number | null };
}
export interface SeriesMapping {
    recordedId: number;
    recordedTitle: string;
    seriesId: number;
    seriesTitle: string;
    episodeId: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    airType: string;
    matchMethod: string;
    confidence: number;
    manualLock: boolean;
}
export interface UpdateSeriesMapping {
    seriesId?: number;
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number | null;
    airType?: string;
}
export default interface ISeriesApiModel {
    list(keyword?: string, offset?: number, limit?: number): Promise<SeriesListResult>;
    get(id: number, channelId?: number): Promise<SeriesDetail>;
    getMapping(recordedId: number): Promise<SeriesMapping | null>;
    updateMapping(recordedId: number, value: UpdateSeriesMapping): Promise<SeriesMapping>;
    removeMapping(recordedId: number): Promise<void>;
    syncAnnict(seriesId: number): Promise<{ annictId: string; syobocalTid: number | null; title: string; score: number }>;
}
