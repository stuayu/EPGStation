import * as apid from '../../../../api';
export type SeriesMappingValue = apid.SeriesMappingValue;
export type UpdateSeriesMappingOption = apid.UpdateSeriesMappingOption;
export default interface ISeriesMappingApiModel {
    get(recordedId: number): Promise<SeriesMappingValue | null>;
    update(recordedId: number, option: UpdateSeriesMappingOption): Promise<SeriesMappingValue>;
    remove(recordedId: number): Promise<void>;
    /**
     * 直前の変更履歴 (割当 / 解除) を取り消し、変更前の状態へ復元する
     */
    undo(recordedId: number): Promise<SeriesMappingValue | null>;
}
