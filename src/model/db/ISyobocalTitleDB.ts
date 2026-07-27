import SyobocalTitle from '../../db/entities/SyobocalTitle';

export interface SyobocalTitleRecord {
    tid: number;
    title: string;
    lookupKey: string;
    shortTitle: string | null;
    titleYomi: string | null;
    titleEn: string | null;
    cat: number | null;
    firstYear: number | null;
    firstMonth: number | null;
    totalEpisodes: number | null;
    lastUpdate: string | null;
    updatedAt: number;
}

export interface SyobocalTitleAliasRecord {
    lookupKey: string;
    tid: number;
    rank: number;
}

export interface SyobocalTitleEpisodeRecord {
    tid: number;
    episodeNumber: number;
    subTitle: string;
    lookupKey: string;
}

export interface SyobocalTitleUpsert {
    title: SyobocalTitleRecord;
    aliases: SyobocalTitleAliasRecord[];
    episodes: SyobocalTitleEpisodeRecord[];
}

export default interface ISyobocalTitleDB {
    /**
     * 作品・別名・サブタイトルをまとめて登録する (同一 TID の既存行は置き換える)
     * @param values: SyobocalTitleUpsert[]
     * @return Promise<void>
     */
    bulkUpsert(values: SyobocalTitleUpsert[]): Promise<void>;
    /**
     * 登録済み作品数を返す (辞書が空かどうかの判定に使う)
     * @return Promise<number>
     */
    count(): Promise<number>;
    /**
     * 登録済み作品の中で最も新しい lastUpdate を返す (差分取得のカーソル)
     * @return Promise<string | null>
     */
    getLatestLastUpdate(): Promise<string | null>;
    /**
     * 照合キー辞書 (正式タイトル + 別名) を全件読み出す。メモリ上の索引構築に使う
     * @return Promise<SyobocalTitleAliasRecord[]>
     */
    listAllAliases(): Promise<SyobocalTitleAliasRecord[]>;
    /**
     * TID から作品を取得する
     * @param tid: number
     * @return Promise<SyobocalTitle | null>
     */
    get(tid: number): Promise<SyobocalTitle | null>;
    /**
     * 指定作品のサブタイトル一覧を返す
     * @param tid: number
     * @return Promise<SyobocalTitleEpisodeRecord[]>
     */
    listEpisodes(tid: number): Promise<SyobocalTitleEpisodeRecord[]>;
    /**
     * 辞書を全件削除する (全件再取得の前処理)
     * @return Promise<void>
     */
    clear(): Promise<void>;
}
