import * as apid from '../../../../api';
export type SeriesMappingValue = apid.SeriesMappingValue;
export type UpdateSeriesMappingOption = apid.UpdateSeriesMappingOption;
export type BulkUpdateSeriesMappingOption = apid.BulkUpdateSeriesMappingOption;
export type BulkUpdateSeriesMappingResult = apid.BulkUpdateSeriesMappingResult;
export default interface ISeriesMappingApiModel {
    get(recordedId: number): Promise<SeriesMappingValue | null>;
    update(recordedId: number, option: UpdateSeriesMappingOption): Promise<SeriesMappingValue>;
    /**
     * 話数・放送種別を複数の録画に対してまとめて更新する。
     * シリーズは既存の割当を引き継ぎ、省略した項目は現在の値を維持する
     * @param option: BulkUpdateSeriesMappingOption
     * @return Promise<BulkUpdateSeriesMappingResult> 更新件数と、失敗した録画の一覧
     */
    updateBulk(option: BulkUpdateSeriesMappingOption): Promise<BulkUpdateSeriesMappingResult>;
    remove(recordedId: number): Promise<void>;
    /**
     * 直前の変更履歴 (割当 / 解除) を取り消し、変更前の状態へ復元する
     */
    undo(recordedId: number): Promise<SeriesMappingValue | null>;
}
