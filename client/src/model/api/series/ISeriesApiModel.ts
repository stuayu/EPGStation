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
    recorded: SeriesRecording[];
    externalIds: { syobocalTid: number | null; annictId: string | null; tmdbId: number | null };
}
export default interface ISeriesApiModel {
    list(keyword?: string, offset?: number, limit?: number): Promise<SeriesListResult>;
    get(id: number, channelId?: number): Promise<SeriesDetail>;
}
