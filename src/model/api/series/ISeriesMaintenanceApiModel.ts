import * as apid from '../../../../api';
export type MergeSeriesResult = apid.MergeSeriesResult;
export type SplitSeriesResult = apid.SplitSeriesResult;
export interface RefreshSeriesMetadataResult {
    // 走査したシリーズ数
    scanned: number;
    // 何らかの項目を更新したシリーズ数
    updated: number;
    // LLM フォールバックへ回したシリーズ数
    llmAnalyzed: number;
    // LLM 経由で外部 ID を確定できたシリーズ数
    llmResolved: number;
}

export interface UpdateSeriesMetadata {
    titleKana?: string | null;
    seasonYear?: number | null;
    seasonName?: string | null;
    totalEpisodes?: number | null;
}

export default interface ISeriesMaintenanceApiModel {
    /**
     * シリーズのクール・読み仮名・総話数を手動で設定する。
     * クールを指定した場合は出所を 'manual' として記録し、以降の自動補完で上書きしない
     * @param seriesId: number
     * @param value: UpdateSeriesMetadata
     * @return Promise<void>
     */
    updateMetadata(seriesId: number, value: UpdateSeriesMetadata): Promise<void>;
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
