export interface SeriesImageInfo {
    // 画像の出所。'annict': Annict 作品辞書の画像 / 'thumbnail': 録画から生成したサムネイル
    source: 'annict' | 'thumbnail';
    // 取得元 URL ('annict' の場合のみ)
    url: string | null;
    // 著作権表記 (表示時のクレジット)。'thumbnail' や取得できない作品では null
    copyright: string | null;
}

export interface SeriesImageFile {
    // ローカルキャッシュ済みファイルのパス
    filePath: string;
    // Content-Type (image/jpeg, image/png など)
    contentType: string;
}

export default interface ISeriesImageModel {
    /**
     * シリーズに紐づくアイキャッチ画像の情報を返す。
     * 画像を持つのは Annict 作品辞書のみ (しょぼいカレンダーは画像を提供していない)。
     * シリーズが作品に紐付いていない、または作品に画像が無い場合は null
     * @param seriesId: number
     * @return Promise<SeriesImageInfo | null>
     */
    getInfo(seriesId: number): Promise<SeriesImageInfo | null>;
    /**
     * 複数シリーズについて画像の有無をまとめて判定する (一覧 API 用)
     * @param seriesIds: number[]
     * @return Promise<Map<number, SeriesImageInfo>> 画像を持つシリーズのみを含む
     */
    getInfoMap(seriesIds: number[]): Promise<Map<number, SeriesImageInfo>>;
    /**
     * シリーズのアイキャッチ画像をローカルキャッシュから返す。
     * 未取得の場合は取得元からダウンロードしてキャッシュしてから返す。
     * 画像が無い・取得に失敗した場合は null
     * @param seriesId: number
     * @return Promise<SeriesImageFile | null>
     */
    getFile(seriesId: number): Promise<SeriesImageFile | null>;
}
