export interface SeriesMetadataFillResult {
    // 走査したシリーズ数
    scanned: number;
    // 何らかの項目を更新したシリーズ数
    updated: number;
    // 表示名を作品辞書の正式タイトルへ合わせたシリーズ数
    titleSynced: number;
    // LLM フォールバックへ回したシリーズ数 (辞書で引けず外部 ID も未設定のもの)
    llmAnalyzed: number;
    // LLM が抽出した作品名で辞書を引き直し、外部 ID を確定できたシリーズ数
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

export interface SeriesMetadataFillOption {
    // 対象を絞り込むシリーズ id (シリーズ詳細画面から 1 件だけ再取得する場合に使う)
    seriesIds?: number[];
    // すでに埋まっている項目も辞書から引き直す。
    // 手動設定 (titleSource / seasonSource / commentSource が manual) は対象外のまま
    force?: boolean;
}

export default interface ISeriesMetadataFiller {
    /**
     * 既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋める。
     * 既に全項目そろっているシリーズは辞書を引かないため繰り返し実行しても安い。
     * 辞書で引けず外部 ID (syobocalTid / annictId) が両方とも空のシリーズだけは、
     * seriesLlm 設定時に LLM へ作品名を抽出させて辞書を引き直す
     * @param option: SeriesMetadataFillOption 対象の絞り込み (省略時は全シリーズ)
     * @return Promise<SeriesMetadataFillResult>
     */
    fill(option?: SeriesMetadataFillOption): Promise<SeriesMetadataFillResult>;
    /**
     * 起動後しばらくしてから fill() を実行する。
     * 作品辞書の同期が終わってから走らせたいので遅延させる (多重起動しない)。
     * 1 回あたりの上限で繰り越したコメント取得が残っている場合は、間隔を空けて自動的に続きを実行する
     */
    scheduleInitialFill(): void;
}
