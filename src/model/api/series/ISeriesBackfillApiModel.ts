import * as apid from '../../../../api';
export type SeriesBackfillOption = apid.SeriesBackfillOption;
export type SeriesBackfillResult = apid.SeriesBackfillResult;
export type SeriesAnalyzeResult = apid.SeriesAnalyzeResult;
export default interface ISeriesBackfillApiModel {
    /**
     * 既存録画のシリーズ化バックフィルを開始する (実行中の場合は現在の状態を返すのみ)
     */
    start(option: SeriesBackfillOption): Promise<SeriesBackfillResult>;
    /**
     * バックフィルの進捗状況を取得する
     */
    getStatus(): Promise<SeriesBackfillResult>;
    /**
     * 実行中のバックフィルをキャンセルする
     */
    cancel(): Promise<void>;

    /**
     * 録画 1 件だけシリーズ判定を実行し、判定過程のトレース付きで結果を返す
     * @param recordedId: apid.RecordedId
     */
    analyze(recordedId: apid.RecordedId): Promise<SeriesAnalyzeResult>;
}
