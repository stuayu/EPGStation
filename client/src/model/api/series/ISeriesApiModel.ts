import * as apid from '../../../../../api';
export type SeriesListItem = apid.SeriesListItem;
export type SeriesListResult = apid.SeriesListResult;
export type SeriesChannel = apid.SeriesDetail['channels'][number];
export type SeriesRecording = apid.SeriesRecordedRow;
export type SeriesDetail = apid.SeriesDetail;
export type SeriesMapping = apid.SeriesMappingValue;
export type UpdateSeriesMapping = apid.UpdateSeriesMappingOption;
export type SeriesPendingMatchItem = apid.SeriesPendingMatchItem;
export type SeriesPendingListResult = apid.SeriesPendingListResult;
export type SeriesAliasItem = apid.SeriesAliasItem;
export type MissingEpisodeProposal = apid.MissingEpisodeProposal;
export type SeriesBackfillOption = apid.SeriesBackfillOption;
export type SeriesBackfillResult = apid.SeriesBackfillResult;
export type ProgramSeriesMetrics = apid.ProgramSeriesMetrics;

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

export interface SeriesListOption {
    keyword?: string;
    offset?: number;
    limit?: number;
    sort?: apid.SeriesSortKey;
    order?: 'asc' | 'desc';
    seasonYear?: number;
    seasonName?: string;
    status?: 'onair' | 'finished';
    hasMissing?: boolean;
}

export default interface ISeriesApiModel {
    /**
     * シリーズ一覧を並べ替え・絞り込み付きで取得する
     * @param option: SeriesListOption
     * @return Promise<SeriesListResult>
     */
    list(option?: SeriesListOption): Promise<SeriesListResult>;
    /**
     * 絞り込み UI 用のクール一覧を取得する
     * @return Promise<apid.SeriesSeasonItem[]>
     */
    listSeasons(): Promise<apid.SeriesSeasonItem[]>;
    /**
     * 既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋め直す
     * @return Promise<RefreshSeriesMetadataResult>
     */
    refreshMetadata(): Promise<RefreshSeriesMetadataResult>;
    /**
     * シリーズのクール・読み仮名・総話数を手動で設定する
     * @param seriesId: number
     * @param value: UpdateSeriesMetadata
     * @return Promise<void>
     */
    updateSeriesMetadata(seriesId: number, value: UpdateSeriesMetadata): Promise<void>;
    getMissingEpisodeProposals(seriesId: number): Promise<MissingEpisodeProposal[]>;
    get(id: number, channelId?: number): Promise<SeriesDetail>;
    getMapping(recordedId: number): Promise<SeriesMapping | null>;
    updateMapping(recordedId: number, value: UpdateSeriesMapping): Promise<SeriesMapping>;
    removeMapping(recordedId: number): Promise<void>;
    undoMapping(recordedId: number): Promise<SeriesMapping | null>;
    syncAnnict(seriesId: number): Promise<{ annictId: string; syobocalTid: number | null; title: string; score: number }>;
    listPending(offset?: number, limit?: number): Promise<SeriesPendingListResult>;
    confirmPending(pendingId: number, value: UpdateSeriesMapping): Promise<SeriesMapping>;
    rejectPending(pendingId: number): Promise<void>;
    merge(fromSeriesId: number, toSeriesId: number): Promise<apid.MergeSeriesResult>;
    split(seriesId: number, recordedIds: number[], newTitle: string): Promise<apid.SplitSeriesResult>;
    listAliases(seriesId?: number): Promise<SeriesAliasItem[]>;
    removeAlias(aliasId: number): Promise<void>;
    startBackfill(option?: SeriesBackfillOption): Promise<SeriesBackfillResult>;
    getBackfillStatus(): Promise<SeriesBackfillResult>;
    cancelBackfill(): Promise<void>;
    reserveMissingEpisode(seriesId: number, seasonNumber: number, episodeNumber: number, programId: number): Promise<{ reserveId: number }>;
    /**
     * 番組⇄シリーズ事前マッピングの精度メトリクスを取得する (§4.10)
     */
    getMetrics(): Promise<ProgramSeriesMetrics>;
}
