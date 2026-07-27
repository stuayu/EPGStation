export default interface ISeriesStartupPipeline {
    /**
     * サーバー起動時のシリーズ照合パイプライン (作品辞書同期の完了待ち → 未リンク録画のバックフィル) を予約する。
     * featureFlags.seriesLibrary が無効、または seriesStartup.enable: false の場合は何もしない (多重呼び出しは無視される)
     */
    schedule(): void;
}
