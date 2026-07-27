export interface SyobocalTitleMatch {
    tid: number;
    // しょぼいカレンダーの正式タイトル (シリーズ表示名として使う)
    title: string;
    // 放送予定総話数 (欠番検出の上限)。取得できない場合は null
    totalEpisodes: number | null;
    // 'exact': 照合キーが辞書キーと完全一致 / 'contain': 辞書キーが録画タイトルのキーに含まれる
    matchType: 'exact' | 'contain';
    // 0〜1 の確度
    confidence: number;
}

export interface SyobocalTitleDictionaryStatus {
    // 辞書に登録されている作品数
    titleCount: number;
    // しょぼいカレンダー側の最終更新日時 (差分取得カーソル)
    lastUpdate: string | null;
    // 直近の同期完了時刻 (ms)
    lastSyncedAt: number | null;
    // 同期実行中か
    running: boolean;
    // 直近の同期で失敗した場合のエラーメッセージ
    error: string | null;
}

export interface SyobocalTitleSyncOption {
    // true の場合は差分取得ではなく全件を取り直す
    full?: boolean;
}

export interface SyobocalTitleSyncResult extends SyobocalTitleDictionaryStatus {
    // 今回の同期で取り込んだ作品数
    imported: number;
    // 全件取得だったか
    full: boolean;
}

export default interface ISyobocalTitleDictionary {
    /**
     * しょぼいカレンダーからアニメ作品タイトルを一括取得して辞書へ取り込む。
     * 辞書が空か full 指定の場合は全件、それ以外は前回の lastUpdate 以降の差分のみ取得する
     * @param option: SyobocalTitleSyncOption
     * @return Promise<SyobocalTitleSyncResult>
     */
    sync(option?: SyobocalTitleSyncOption): Promise<SyobocalTitleSyncResult>;
    /**
     * 起動時 + 一定間隔で sync() を実行する (多重起動しない)
     */
    startAutoSync(): void;
    /**
     * 録画番組タイトルから しょぼいカレンダー作品を特定する。
     * 辞書が空・機能無効・該当なしの場合は null を返す
     * @param recordedTitle: string 録画番組タイトル (生のまま渡してよい)
     * @return Promise<SyobocalTitleMatch | null>
     */
    lookup(recordedTitle: string): Promise<SyobocalTitleMatch | null>;
    /**
     * サブタイトル文字列から話数を逆引きする (話数表記の無いタイトル用)
     * @param tid: number
     * @param recordedTitle: string 録画番組タイトル
     * @return Promise<number | null>
     */
    lookupEpisodeNumber(tid: number, recordedTitle: string): Promise<number | null>;
    /**
     * 現在の辞書の状態を返す
     * @return Promise<SyobocalTitleDictionaryStatus>
     */
    getStatus(): Promise<SyobocalTitleDictionaryStatus>;
}
