import * as apid from '../../../../api';
export type MergeSeriesResult = apid.MergeSeriesResult;
export type SplitSeriesResult = apid.SplitSeriesResult;
export default interface ISeriesMaintenanceApiModel {
    /**
     * fromSeriesId のリンク・エピソード・エイリアスを toSeriesId へ統合し、fromSeriesId を削除する
     */
    merge(fromSeriesId: number, toSeriesId: number): Promise<MergeSeriesResult>;
    /**
     * 指定した録画群を新しいシリーズへ分割する
     */
    split(seriesId: number, recordedIds: number[], newTitle: string): Promise<SplitSeriesResult>;
}
