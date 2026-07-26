import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import SeriesEpisode from '../../db/entities/SeriesEpisode';
export interface NewSeries {
    title: string;
    normalizedTitle: string;
    preferredChannelId: number | null;
    createdAt: number;
    updatedAt: number;
}
export interface NewEpisode {
    seriesId: number;
    seasonNumber: number;
    episodeNumber: number | null;
    episodeLabel: string | null;
    title: null;
    airedAt: number | null;
    createdAt: number;
    updatedAt: number;
}
export interface SaveSeriesLink {
    recordedId: number;
    seriesId: number;
    episodeId: number | null;
    airType: RecordedSeriesLink['airType'];
    matchMethod: RecordedSeriesLink['matchMethod'];
    confidence: number;
    manualLock: boolean;
    createdAt: number;
    updatedAt: number;
}
export interface SeriesRecordedRow {
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
export interface SeriesChannelRow {
    channelId: number;
    channelName: string | null;
    count: number;
}
export default interface ISeriesDB {
    findCandidates(normalizedTitle: string): Promise<Series[]>;
    createSeries(value: NewSeries): Promise<Series>;
    findEpisode(seriesId: number, seasonNumber: number, episodeNumber: number | null): Promise<SeriesEpisode | null>;
    createEpisode(value: NewEpisode): Promise<SeriesEpisode>;
    findLink(recordedId: number): Promise<RecordedSeriesLink | null>;
    saveLink(value: SaveSeriesLink): Promise<RecordedSeriesLink>;
    list(keyword: string | undefined, offset: number, limit: number): Promise<[Series[], number]>;
    getSeries(id: number): Promise<Series | null>;
    listRecorded(seriesId: number, channelId?: number): Promise<SeriesRecordedRow[]>;
    listChannels(seriesId: number): Promise<SeriesChannelRow[]>;
}
