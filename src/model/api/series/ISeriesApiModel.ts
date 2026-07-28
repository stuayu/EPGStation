import * as apid from '../../../../api';
export type SeriesContinuityResult = apid.SeriesDetail['continuity'];
export type SeriesListItem = apid.SeriesListItem;
export type SeriesListResult = apid.SeriesListResult;
export type SeriesDetail = apid.SeriesDetail;

export interface SeriesListOption {
    keyword?: string;
    offset: number;
    limit: number;
    sort?: apid.SeriesSortKey;
    order?: 'asc' | 'desc';
    seasonYear?: number;
    seasonName?: string;
    status?: 'onair' | 'finished';
    // 'dictionary': 外部の作品辞書起点のシリーズのみ / 'local': 録画タイトルから作られたシリーズのみ
    origin?: apid.SeriesOrigin;
    // true の場合、欠番のあるシリーズのみに絞り込む
    hasMissing?: boolean;
}
export default interface ISeriesApiModel {
    /**
     * シリーズ一覧を並べ替え・絞り込み付きで取得する
     * @param option: SeriesListOption
     * @return Promise<SeriesListResult>
     */
    list(option: SeriesListOption): Promise<SeriesListResult>;
    /**
     * 絞り込み UI 用に、登録されているクールの一覧を返す
     * @return Promise<apid.SeriesSeasonItem[]>
     */
    listSeasons(): Promise<apid.SeriesSeasonItem[]>;
    get(id: number, channelId?: number): Promise<SeriesDetail | null>;
}
