import * as apid from '../../../../api';
export type SeriesContinuityResult = apid.SeriesDetail['continuity'];
export type SeriesListItem = apid.SeriesListItem;
export type SeriesListResult = apid.SeriesListResult;
export type SeriesDetail = apid.SeriesDetail;
export default interface ISeriesApiModel {
    list(keyword: string | undefined, offset: number, limit: number): Promise<SeriesListResult>;
    get(id: number, channelId?: number): Promise<SeriesDetail | null>;
}
