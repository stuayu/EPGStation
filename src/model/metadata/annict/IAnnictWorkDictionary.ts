export interface AnnictWorkDictionaryStatus {
    // 辞書に登録されている作品数
    workCount: number;
    // そのうち syobocalTid を持つ (しょぼいカレンダー作品と厳密に結合できる) 作品数
    linkedToSyobocalCount: number;
    // 直近の同期完了時刻 (ms)
    lastSyncedAt: number | null;
    // 同期実行中か
    running: boolean;
    // 直近の同期で失敗した場合のエラーメッセージ
    error: string | null;
}

export interface AnnictWorkSyncResult extends AnnictWorkDictionaryStatus {
    // 今回の同期で取り込んだ作品数
    imported: number;
}

export default interface IAnnictWorkDictionary {
    /**
     * Annict から全作品を searchWorks のページングで取得し、辞書へ取り込む。
     * Annict は差分取得 API を提供していないため常に全件を取り直す (取得件数は 2 万件弱)
     * @return Promise<AnnictWorkSyncResult>
     */
    sync(): Promise<AnnictWorkSyncResult>;
    /**
     * 起動時 + 一定間隔で sync() を実行する (多重起動しない)
     */
    startAutoSync(): void;
    /**
     * 現在の辞書の状態を返す
     * @return Promise<AnnictWorkDictionaryStatus>
     */
    getStatus(): Promise<AnnictWorkDictionaryStatus>;
}
