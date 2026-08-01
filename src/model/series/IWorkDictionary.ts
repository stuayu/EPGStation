export interface WorkMatch {
    // しょぼいカレンダー TID (辞書に無い作品では null)
    syobocalTid: number | null;
    // Annict 作品 ID (辞書に無い作品では null)
    annictId: number | null;
    // Wikidata 項目 ID (アニメ辞書だけで確定した作品では null)
    wikidataQid: string | null;
    // TMDb テレビシリーズ ID (Wikidata の P4983 由来。取得できない場合は null)
    tmdbId: number | null;
    // シリーズ表示名に使う正式タイトル
    title: string;
    // 読み仮名 (あいうえお順の並べ替え用)。取得できない場合は null
    titleKana: string | null;
    // 放送クール。取得できない場合は null
    seasonYear: number | null;
    seasonName: 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN' | null;
    // 放送予定総話数 (欠番検出の上限)。取得できない場合は null
    totalEpisodes: number | null;
    // 'exact': 照合キーが辞書キーと完全一致
    // 'contain': 辞書キーが録画タイトルのキーに含まれる (枠名等の余分な語がある)
    // 'prefix': 録画タイトルのキーが辞書キーの前方一致 (EPG の文字数制限で末尾が切れている)
    matchType: 'exact' | 'contain' | 'prefix';
    // 0〜1 の確度
    confidence: number;
    // どの辞書で確定したか
    source: 'syobocal' | 'annict' | 'wikidata';
}

export default interface IWorkDictionary {
    /**
     * 録画番組タイトルから作品を特定する。
     * しょぼいカレンダー辞書と Annict 辞書を統合した索引を引き、両方に存在する作品は
     * Annict の syobocalTid を使って 1 件へ統合する。該当なしの場合は null を返す
     * 引き当てた作品に続編 (第 2 期など) がある場合は、airedAt を渡すとその放送日時に合う期を選ぶ
     * (局が期の表記を送出しない録画で、常に第 1 期へ寄ってしまうのを防ぐ)
     * @param recordedTitle: string 録画番組タイトル (生のまま渡してよい)
     * @param airedAt: number | undefined 録画の放送開始時刻。再放送など放送日時から期を決められない
     *                 場合は渡さないこと
     * @return Promise<WorkMatch | null>
     */
    lookup(recordedTitle: string, airedAt?: number): Promise<WorkMatch | null>;
    /**
     * サブタイトル文字列から話数を逆引きする (話数表記の無いタイトル用)。
     * しょぼいカレンダーのサブタイトル一覧のみを使う (Annict 側は話数の欠落が多いため)
     * @param syobocalTid: number
     * @param recordedTitle: string 録画番組タイトル
     * @return Promise<number | null>
     */
    lookupEpisodeNumber(syobocalTid: number, recordedTitle: string): Promise<number | null>;
    /**
     * 話数からサブタイトルを引く (エピソード名の補完用)。
     * ローカルに取り込み済みのしょぼいカレンダーのサブタイトル一覧のみを使うため外部通信は伴わない
     * @param syobocalTid: number
     * @param episodeNumber: number
     * @return Promise<string | null> 該当する話数が無ければ null
     */
    lookupEpisodeTitle(syobocalTid: number, episodeNumber: number): Promise<string | null>;
    /**
     * キーワードで作品辞書 (しょぼいカレンダー / Annict / Wikidata) を横断検索する。
     * エイリアス辞書の手動修正で、まだローカルに無い作品を探すために使う
     * @param keyword: string 検索キーワード (生のまま渡してよい)
     * @param limit: number | undefined 最大件数
     * @return Promise<WorkMatch[]> 照合キーが短い (= キーワードに近い) 順
     */
    search(keyword: string, limit?: number): Promise<WorkMatch[]>;
    /**
     * 外部 ID から辞書の作品を引く。
     * search() の結果からシリーズを作るときに、クライアントから受け取った ID を
     * 信用せずサーバー側で作品情報を解決し直すために使う
     * @param ids: しょぼいカレンダー TID / Annict 作品 ID / Wikidata 項目 ID
     * @return Promise<WorkMatch | null> どの辞書にも無ければ null
     */
    findByIds(ids: {
        syobocalTid?: number | null;
        annictId?: number | null;
        wikidataQid?: string | null;
    }): Promise<WorkMatch | null>;
}
