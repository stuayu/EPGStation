import * as apid from '../../../../api';
export type MergeSeriesResult = apid.MergeSeriesResult;
export type SplitSeriesResult = apid.SplitSeriesResult;
export interface RefreshSeriesMetadataResult {
    // 走査したシリーズ数
    scanned: number;
    // 何らかの項目を更新したシリーズ数
    updated: number;
}

export default interface ISeriesMaintenanceApiModel {
    /**
     * 既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋め直す。
     * 辞書の導入前に作られたシリーズや、辞書が更新された後の追随に使う
     * @return Promise<RefreshSeriesMetadataResult>
     */
    refreshMetadata(): Promise<RefreshSeriesMetadataResult>;
    /**
     * fromSeriesId のリンク・エピソード・エイリアスを toSeriesId へ統合し、fromSeriesId を削除する
     */
    merge(fromSeriesId: number, toSeriesId: number): Promise<MergeSeriesResult>;
    /**
     * 指定した録画群を新しいシリーズへ分割する
     */
    split(seriesId: number, recordedIds: number[], newTitle: string): Promise<SplitSeriesResult>;
}
