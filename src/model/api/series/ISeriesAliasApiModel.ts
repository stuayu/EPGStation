import * as apid from '../../../../api';
export type SeriesAliasItem = apid.SeriesAliasItem;
export type UpdateSeriesAliasOption = apid.UpdateSeriesAliasOption;
export type BulkUpdateSeriesAliasOption = apid.BulkUpdateSeriesAliasOption;
export type BulkUpdateSeriesAliasResult = apid.BulkUpdateSeriesAliasResult;
export default interface ISeriesAliasApiModel {
    list(seriesId?: number): Promise<SeriesAliasItem[]>;
    /**
     * エイリアスの付け替え先シリーズを変更する。
     * 付け替えた辞書は手動修正扱い (source: 'manual') になり、以後の自動学習で上書きされない
     * @param aliasId: number
     * @param option: UpdateSeriesAliasOption
     * @return Promise<SeriesAliasItem>
     */
    update(aliasId: number, option: UpdateSeriesAliasOption): Promise<SeriesAliasItem>;
    /**
     * エイリアスの付け替え・削除をまとめて行う (LLM が誤学習した規則の一括修正用)
     * @param option: BulkUpdateSeriesAliasOption
     * @return Promise<BulkUpdateSeriesAliasResult>
     */
    updateBulk(option: BulkUpdateSeriesAliasOption): Promise<BulkUpdateSeriesAliasResult>;
    remove(aliasId: number): Promise<void>;
}
