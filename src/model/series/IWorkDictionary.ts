export interface WorkMatch {
    // しょぼいカレンダー TID (辞書に無い作品では null)
    syobocalTid: number | null;
    // Annict 作品 ID (辞書に無い作品では null)
    annictId: number | null;
    // シリーズ表示名に使う正式タイトル
    title: string;
    // 放送予定総話数 (欠番検出の上限)。取得できない場合は null
    totalEpisodes: number | null;
    // 'exact': 照合キーが辞書キーと完全一致
    // 'contain': 辞書キーが録画タイトルのキーに含まれる (枠名等の余分な語がある)
    // 'prefix': 録画タイトルのキーが辞書キーの前方一致 (EPG の文字数制限で末尾が切れている)
    matchType: 'exact' | 'contain' | 'prefix';
    // 0〜1 の確度
    confidence: number;
    // どちらの辞書で確定したか
    source: 'syobocal' | 'annict';
}

export default interface IWorkDictionary {
    /**
     * 録画番組タイトルから作品を特定する。
     * しょぼいカレンダー辞書と Annict 辞書を統合した索引を引き、両方に存在する作品は
     * Annict の syobocalTid を使って 1 件へ統合する。該当なしの場合は null を返す
     * @param recordedTitle: string 録画番組タイトル (生のまま渡してよい)
     * @return Promise<WorkMatch | null>
     */
    lookup(recordedTitle: string): Promise<WorkMatch | null>;
    /**
     * サブタイトル文字列から話数を逆引きする (話数表記の無いタイトル用)。
     * しょぼいカレンダーのサブタイトル一覧のみを使う (Annict 側は話数の欠落が多いため)
     * @param syobocalTid: number
     * @param recordedTitle: string 録画番組タイトル
     * @return Promise<number | null>
     */
    lookupEpisodeNumber(syobocalTid: number, recordedTitle: string): Promise<number | null>;
}
