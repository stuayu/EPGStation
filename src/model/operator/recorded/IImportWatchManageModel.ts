export default interface IImportWatchManageModel {
    /**
     * config.importWatch が有効な場合、importDirs の定期監視を開始する
     * 無効な場合は何もしない
     */
    start(): void;

    /**
     * 監視を停止する (主にテスト用)
     */
    stop(): void;
}
