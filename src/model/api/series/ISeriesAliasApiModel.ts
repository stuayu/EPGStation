import * as apid from '../../../../api';
export type SeriesAliasItem = apid.SeriesAliasItem;
export default interface ISeriesAliasApiModel {
    list(seriesId?: number): Promise<SeriesAliasItem[]>;
    remove(aliasId: number): Promise<void>;
}
