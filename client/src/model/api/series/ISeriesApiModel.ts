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
export type SeriesAnalyzeResult = apid.SeriesAnalyzeResult;
export type SeriesAnalyzeStep = apid.SeriesAnalyzeStep;
export type ProgramSeriesMetrics = apid.ProgramSeriesMetrics;
export type SeriesMergeCandidate = apid.SeriesMergeCandidate;
export type SeriesMergeCandidateResult = apid.SeriesMergeCandidateResult;
export type BulkSeriesMappingItem = apid.BulkSeriesMappingItem;
export type EmptySeriesItem = apid.EmptySeriesItem;
export type EmptySeriesListResult = apid.EmptySeriesListResult;
export type DeleteEmptySeriesResult = apid.DeleteEmptySeriesResult;
export type DictionaryWorkItem = apid.DictionaryWorkItem;
export type DictionaryWorkSearchResult = apid.DictionaryWorkSearchResult;
export type CreateSeriesFromDictionaryResult = apid.CreateSeriesFromDictionaryResult;

export interface RefreshSeriesMetadataResult {
    // 走査したシリーズ数
    scanned: number;
    // 何らかの項目を更新したシリーズ数
    updated: number;
    // 表示名を作品辞書の正式タイトルへ合わせたシリーズ数
    titleSynced: number;
    // LLM フォールバックへ回したシリーズ数
    llmAnalyzed: number;
    // LLM 経由で外部 ID を確定できたシリーズ数
    llmResolved: number;
    // しょぼいカレンダーへ作品コメントを取りに行った件数
    commentFetched: number;
    // 実際に作品コメントを埋められた件数
    commentFilled: number;
    // 1 回あたりの上限に達して次回へ繰り越したコメント取得の件数
    commentPending: number;
    // しょぼいカレンダー TID が無くコメントを引けなかったシリーズ数
    commentSkippedNoTid: number;
}
export interface UpdateSeriesMetadata {
    // シリーズ表示名。設定すると出所が 'manual' になり、辞書の再取得で上書きされない。
    // null を渡すと手動設定を解除し、次回の再取得で作品辞書の正式タイトルへ戻す
    title?: string | null;
    titleKana?: string | null;
    seasonYear?: number | null;
    seasonName?: string | null;
    totalEpisodes?: number | null;
    comment?: string | null;
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
    // 'dictionary': 外部の作品辞書起点のシリーズのみ / 'local': 録画タイトルから作られたシリーズのみ
    origin?: apid.SeriesOrigin;
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
     * @param seriesId: number | undefined 指定するとそのシリーズだけを対象にし、埋まっている項目も引き直す
     * @return Promise<RefreshSeriesMetadataResult>
     */
    refreshMetadata(seriesId?: number): Promise<RefreshSeriesMetadataResult>;
    /**
     * シリーズのクール・読み仮名・総話数を手動で設定する
     * @param seriesId: number
     * @param value: UpdateSeriesMetadata
     * @return Promise<void>
     */
    updateSeriesMetadata(seriesId: number, value: UpdateSeriesMetadata): Promise<void>;
    /**
     * 放送回コメントを更新する (null または空文字で削除)
     * @param episodeId: number
     * @param comment: string | null
     * @return Promise<void>
     */
    updateEpisodeComment(episodeId: number, comment: string | null): Promise<void>;
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
    /**
     * 複数のシリーズを 1 つのシリーズへ統合する (統合元は削除される)
     */
    merge(fromSeriesIds: number[], toSeriesId: number): Promise<apid.MergeSeriesResult>;
    /**
     * 正規化タイトルの前方一致でマージ候補を取得する
     */
    getMergeCandidates(seriesId: number): Promise<apid.SeriesMergeCandidateResult>;
    /**
     * 話数・放送種別をまとめて更新する (省略した項目は現在値を維持)
     */
    updateMappingBulk(items: apid.BulkSeriesMappingItem[]): Promise<apid.BulkUpdateSeriesMappingResult>;
    split(seriesId: number, recordedIds: number[], newTitle: string): Promise<apid.SplitSeriesResult>;
    /**
     * 録画が 0 件のシリーズ (取り残された自動生成シリーズ) を取得する
     * @return Promise<EmptySeriesListResult>
     */
    listEmptySeries(): Promise<EmptySeriesListResult>;
    /**
     * 録画が 0 件のシリーズを削除する (seriesIds 省略時はすべて削除)
     * @param seriesIds: number[] | undefined
     * @return Promise<DeleteEmptySeriesResult>
     */
    deleteEmptySeries(seriesIds?: number[]): Promise<DeleteEmptySeriesResult>;
    /**
     * 作品辞書 (しょぼいカレンダー / Annict / Wikidata) をキーワードで横断検索する
     * @param keyword: string 検索キーワード
     * @param limit: number | undefined 最大件数
     * @return Promise<DictionaryWorkSearchResult>
     */
    searchDictionary(keyword: string, limit?: number): Promise<DictionaryWorkSearchResult>;
    /**
     * 辞書の作品からシリーズを作る (既存ならそれを返す)
     * @param work: DictionaryWorkItem 検索結果 1 件
     * @return Promise<CreateSeriesFromDictionaryResult>
     */
    createSeriesFromDictionary(work: DictionaryWorkItem): Promise<CreateSeriesFromDictionaryResult>;
    listAliases(seriesId?: number): Promise<SeriesAliasItem[]>;
    /**
     * エイリアス辞書の付け替え先シリーズを変更する (付け替え後は手動修正扱いになる)
     */
    updateAlias(aliasId: number, value: apid.UpdateSeriesAliasOption): Promise<SeriesAliasItem>;
    /**
     * エイリアス辞書の付け替え・削除をまとめて行う
     */
    updateAliasBulk(items: apid.BulkSeriesAliasItem[]): Promise<apid.BulkUpdateSeriesAliasResult>;
    removeAlias(aliasId: number): Promise<void>;
    startBackfill(option?: SeriesBackfillOption): Promise<SeriesBackfillResult>;
    getBackfillStatus(): Promise<SeriesBackfillResult>;
    cancelBackfill(): Promise<void>;
    analyze(recordedId: apid.RecordedId): Promise<SeriesAnalyzeResult>;
    reserveMissingEpisode(seriesId: number, seasonNumber: number, episodeNumber: number, programId: number): Promise<{ reserveId: number }>;
    /**
     * 番組⇄シリーズ事前マッピングの精度メトリクスを取得する (§4.10)
     */
    getMetrics(): Promise<ProgramSeriesMetrics>;
}
