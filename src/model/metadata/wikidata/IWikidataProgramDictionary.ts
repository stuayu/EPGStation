export interface WikidataProgramDictionaryStatus {
    // 辞書に登録されている番組数
    programCount: number;
    // そのうち syobocalTid (P11648) を持つ = しょぼいカレンダー作品と厳密に結合できる番組数
    linkedToSyobocalCount: number;
    // 直近の同期完了時刻 (ms)
    lastSyncedAt: number | null;
    // 同期実行中か
    running: boolean;
    // 直近の同期で失敗した場合のエラーメッセージ
    error: string | null;
}

export interface WikidataProgramSyncResult extends WikidataProgramDictionaryStatus {
    // 今回の同期で取り込んだ番組数
    imported: number;
}

export default interface IWikidataProgramDictionary {
    /**
     * Wikidata の SPARQL エンドポイントから日本のテレビ番組を一括取得し、辞書へ取り込む。
     * 差分取得の手段が無いため常に全件を取り直す (約 4 万件)
     * @return Promise<WikidataProgramSyncResult>
     */
    sync(): Promise<WikidataProgramSyncResult>;
    /**
     * 起動時 + 一定間隔で sync() を実行する (多重起動しない)
     */
    startAutoSync(): void;
    /**
     * 現在の辞書の状態を返す
     * @return Promise<WikidataProgramDictionaryStatus>
     */
    getStatus(): Promise<WikidataProgramDictionaryStatus>;
}
