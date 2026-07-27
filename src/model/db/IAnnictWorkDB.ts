import AnnictWork from '../../db/entities/AnnictWork';

export interface AnnictWorkRecord {
    annictId: number;
    title: string;
    lookupKey: string;
    titleEn: string | null;
    titleKana: string | null;
    titleRo: string | null;
    syobocalTid: number | null;
    seasonYear: number | null;
    seasonName: string | null;
    episodesCount: number | null;
    media: string | null;
    imageUrl: string | null;
    imageCopyright: string | null;
    updatedAt: number;
}

export interface AnnictWorkAliasRecord {
    lookupKey: string;
    annictId: number;
    rank: number;
}

export interface AnnictWorkAliasWithLink extends AnnictWorkAliasRecord {
    // 対応するしょぼいカレンダー TID (Annict 側が保持する対応表より)。未登録作品では null
    syobocalTid: number | null;
}

export interface AnnictWorkUpsert {
    work: AnnictWorkRecord;
    aliases: AnnictWorkAliasRecord[];
}

export default interface IAnnictWorkDB {
    /**
     * 作品・別名をまとめて登録する (同一 annictId の既存行は置き換える)
     * @param values: AnnictWorkUpsert[]
     * @return Promise<void>
     */
    bulkUpsert(values: AnnictWorkUpsert[]): Promise<void>;
    /**
     * 登録済み作品数を返す
     * @return Promise<number>
     */
    count(): Promise<number>;
    /**
     * syobocalTid を持つ (しょぼいカレンダー作品と厳密に結合できる) 作品数を返す
     * @return Promise<number>
     */
    countLinkedToSyobocal(): Promise<number>;
    /**
     * 照合キー辞書 (正式タイトル + 別名) を全件読み出す。メモリ上の索引構築に使う。
     * 索引構築時に作品ごとの再問い合わせが起きないよう syobocalTid を同梱する
     * @return Promise<AnnictWorkAliasWithLink[]>
     */
    listAllAliases(): Promise<AnnictWorkAliasWithLink[]>;
    /**
     * annictId から作品を取得する
     * @param annictId: number
     * @return Promise<AnnictWork | null>
     */
    get(annictId: number): Promise<AnnictWork | null>;
    /**
     * しょぼいカレンダー TID から Annict 作品を引く (作品の厳密な相互解決に使う)
     * @param syobocalTid: number
     * @return Promise<AnnictWork | null>
     */
    findBySyobocalTid(syobocalTid: number): Promise<AnnictWork | null>;
    /**
     * 辞書を全件削除する (全件再取得の前処理)
     * @return Promise<void>
     */
    clear(): Promise<void>;
}
