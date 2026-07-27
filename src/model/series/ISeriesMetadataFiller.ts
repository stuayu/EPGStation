export interface SeriesMetadataFillResult {
    // 走査したシリーズ数
    scanned: number;
    // 何らかの項目を更新したシリーズ数
    updated: number;
}

export default interface ISeriesMetadataFiller {
    /**
     * 既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋める。
     * 既に全項目そろっているシリーズは辞書を引かないため繰り返し実行しても安い
     * @return Promise<SeriesMetadataFillResult>
     */
    fill(): Promise<SeriesMetadataFillResult>;
    /**
     * 起動後しばらくしてから一度だけ fill() を実行する。
     * 作品辞書の同期が終わってから走らせたいので遅延させる (多重起動しない)
     */
    scheduleInitialFill(): void;
}
