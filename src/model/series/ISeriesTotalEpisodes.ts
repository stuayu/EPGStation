import Series from '../../db/entities/Series';

export default interface ISeriesTotalEpisodes {
    /**
     * シリーズの「放送予定総話数」をシーズン番号ごとに返す (欠番検出の上限に使う)
     * @param series: Series
     * @return Promise<Record<number, number> | undefined> 総話数が分からない場合は undefined
     */
    resolve(series: Series): Promise<Record<number, number> | undefined>;

    /**
     * 複数シリーズ分の放送予定総話数をまとめて返す (一覧表示用)
     * @param seriesList: Series[]
     * @return Promise<Map<number, Record<number, number>>> seriesId → シーズン番号ごとの総話数
     */
    resolveMany(seriesList: Series[]): Promise<Map<number, Record<number, number>>>;
}
