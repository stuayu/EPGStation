import WikidataProgram from '../../db/entities/WikidataProgram';

export interface WikidataProgramRecord {
    qid: string;
    title: string;
    strictKey: string;
    syobocalTid: number | null;
    tmdbId: number | null;
    updatedAt: number;
}

export interface WikidataProgramAliasRecord {
    strictKey: string;
    qid: string;
    rank: number;
}

export interface WikidataProgramAliasWithLink extends WikidataProgramAliasRecord {
    // 対応するしょぼいカレンダー TID (Wikidata の P11648 より)。未登録番組では null
    syobocalTid: number | null;
}

export interface WikidataProgramUpsert {
    program: WikidataProgramRecord;
    aliases: WikidataProgramAliasRecord[];
}

export default interface IWikidataProgramDB {
    /**
     * 番組・別名をまとめて登録する (同一 qid の既存行は置き換える)
     * @param values: WikidataProgramUpsert[]
     * @return Promise<void>
     */
    bulkUpsert(values: WikidataProgramUpsert[]): Promise<void>;
    /**
     * 登録済み番組数を返す
     * @return Promise<number>
     */
    count(): Promise<number>;
    /**
     * syobocalTid を持つ (しょぼいカレンダー作品と厳密に結合できる) 番組数を返す
     * @return Promise<number>
     */
    countLinkedToSyobocal(): Promise<number>;
    /**
     * 厳密照合キー辞書 (正式ラベル + 別名) を全件読み出す。メモリ上の索引構築に使う
     * @return Promise<WikidataProgramAliasWithLink[]>
     */
    listAllAliases(): Promise<WikidataProgramAliasWithLink[]>;
    /**
     * qid から番組を取得する
     * @param qid: string
     * @return Promise<WikidataProgram | null>
     */
    get(qid: string): Promise<WikidataProgram | null>;
    /**
     * 辞書を全件削除する (全件再取得の前処理)
     * @return Promise<void>
     */
    clear(): Promise<void>;
}
