export interface SeriesMetadataFillResult {
    // 走査したシリーズ数
    scanned: number;
    // 何らかの項目を更新したシリーズ数
    updated: number;
    // LLM フォールバックへ回したシリーズ数 (辞書で引けず外部 ID も未設定のもの)
    llmAnalyzed: number;
    // LLM が抽出した作品名で辞書を引き直し、外部 ID を確定できたシリーズ数
    llmResolved: number;
}

export default interface ISeriesMetadataFiller {
    /**
     * 既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋める。
     * 既に全項目そろっているシリーズは辞書を引かないため繰り返し実行しても安い。
     * 辞書で引けず外部 ID (syobocalTid / annictId) が両方とも空のシリーズだけは、
     * seriesLlm 設定時に LLM へ作品名を抽出させて辞書を引き直す
     * @return Promise<SeriesMetadataFillResult>
     */
    fill(): Promise<SeriesMetadataFillResult>;
    /**
     * 起動後しばらくしてから一度だけ fill() を実行する。
     * 作品辞書の同期が終わってから走らせたいので遅延させる (多重起動しない)
     */
    scheduleInitialFill(): void;
}
