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

// 続編 (期) の判定に使う、作品ごとの照合キーと放送時期
export interface SyobocalTitleSeasonRecord {
    tid: number;
    lookupKey: string;
    firstYear: number | null;
    firstMonth: number | null;
    totalEpisodes: number | null;
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
     * 作品ごとの照合キーと放送時期を全件読み出す。
     * 同じ作品の続編 (第 2 期など) を放送時期で選び分けるための索引構築に使う
     * @return Promise<SyobocalTitleSeasonRecord[]>
     */
    listSeasons(): Promise<SyobocalTitleSeasonRecord[]>;
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
