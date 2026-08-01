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
     * 現在の辞書の状態を返す
     * @return Promise<SyobocalTitleDictionaryStatus>
     */
    getStatus(): Promise<SyobocalTitleDictionaryStatus>;
    /**
     * 作品コメント (TitleItem.Comment。公式リンク・スタッフ・主題歌などの覚え書き) を 1 件だけ取得する。
     *
     * コメントは 1 作品あたり数 KB あり、全件同期に含めると XML が 9.5MB → 24MB に膨らむため
     * 辞書本体には取り込まない。シリーズになっている作品だけを TID 指定で個別に引く
     * @param tid: number しょぼいカレンダー TID
     * @return Promise<string | null> 連携が無効・取得失敗・コメント無しの場合は null
     */
    fetchComment(tid: number): Promise<string | null>;
}
