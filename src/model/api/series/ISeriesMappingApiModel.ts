export interface SeriesMappingValue {
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
export interface UpdateSeriesMappingOption {
    seriesId?: number;
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number | null;
    airType?: 'first' | 'rerun' | 'delayed' | 'unknown';
}
export default interface ISeriesMappingApiModel {
    get(recordedId: number): Promise<SeriesMappingValue | null>;
    update(recordedId: number, option: UpdateSeriesMappingOption): Promise<SeriesMappingValue>;
    remove(recordedId: number): Promise<void>;
}
