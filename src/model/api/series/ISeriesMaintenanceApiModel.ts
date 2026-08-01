import * as apid from '../../../../api';
export type MergeSeriesResult = apid.MergeSeriesResult;
export type SplitSeriesResult = apid.SplitSeriesResult;
export type SeriesMergeCandidateResult = apid.SeriesMergeCandidateResult;
export type EmptySeriesListResult = apid.EmptySeriesListResult;
export type DeleteEmptySeriesResult = apid.DeleteEmptySeriesResult;
export type DictionaryWorkSearchResult = apid.DictionaryWorkSearchResult;
export type CreateSeriesFromDictionaryOption = apid.CreateSeriesFromDictionaryOption;
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
    // 作品コメント。null または空文字で削除する
    comment?: string | null;
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
     * エピソードの放送回コメントを手動で設定する (null / 空文字で削除)。
     * 手動設定した値は出所が 'manual' になり、以降の自動取得で上書きされない
     * @param episodeId: number
     * @param comment: string | null
     * @return Promise<void>
     */
    updateEpisodeComment(episodeId: number, comment: string | null): Promise<void>;
    /**
     * 既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋め直す。
     * 辞書の導入前に作られたシリーズや、辞書が更新された後の追随に使う
     * @param seriesId: number | undefined 指定した場合はそのシリーズだけを対象にし、
     *                  すでに埋まっている項目も辞書の値で引き直す (手動設定は除く)
     * @return Promise<RefreshSeriesMetadataResult>
     */
    refreshMetadata(seriesId?: number): Promise<RefreshSeriesMetadataResult>;
    /**
     * fromSeriesIds のリンク・エピソード・エイリアスを toSeriesId へ統合し、統合元のシリーズを削除する
     * @param fromSeriesIds: number[] 統合元。toSeriesId が混ざっていても無視する
     * @param toSeriesId: number 統合先
     * @return Promise<MergeSeriesResult>
     */
    merge(fromSeriesIds: number[], toSeriesId: number): Promise<MergeSeriesResult>;
    /**
     * 指定シリーズのマージ候補を正規化タイトルの前方一致で探す
     * @param seriesId: number マージ元 (統合される側)
     * @return Promise<SeriesMergeCandidateResult>
     */
    listMergeCandidates(seriesId: number): Promise<SeriesMergeCandidateResult>;
    /**
     * 指定した録画群を新しいシリーズへ分割する
     */
    split(seriesId: number, recordedIds: number[], newTitle: string): Promise<SplitSeriesResult>;
    /**
     * 録画が 0 件のシリーズ (マージ・分割・録画削除で取り残された自動生成シリーズ) を列挙する
     * @return Promise<EmptySeriesListResult>
     */
    listEmpty(): Promise<EmptySeriesListResult>;
    /**
     * 録画が 0 件のシリーズを削除する。
     * seriesIds を省略した場合は現時点で録画 0 件のシリーズをすべて削除する
     * @param seriesIds: number[] | undefined 削除対象を限定する場合のシリーズ ID
     * @return Promise<DeleteEmptySeriesResult>
     */
    deleteEmpty(seriesIds?: number[]): Promise<DeleteEmptySeriesResult>;
    /**
     * 作品辞書 (しょぼいカレンダー / Annict / Wikidata) をキーワードで横断検索する。
     * 各件には、すでにローカルにあるシリーズの id を付けて返す
     * @param keyword: string 検索キーワード
     * @param limit: number | undefined 最大件数
     * @return Promise<DictionaryWorkSearchResult>
     */
    searchDictionary(keyword: string, limit?: number): Promise<DictionaryWorkSearchResult>;
    /**
     * 辞書の作品からシリーズを作る。
     * 同じ外部 ID / 正規化タイトルのシリーズがあれば作らずにそれを返す
     * @param option: CreateSeriesFromDictionaryOption 外部 ID (いずれか 1 つ以上)
     * @return Promise<CreateSeriesFromDictionaryResult>
     */
    createFromDictionary(option: CreateSeriesFromDictionaryOption): Promise<CreateSeriesFromDictionaryResult>;
}
