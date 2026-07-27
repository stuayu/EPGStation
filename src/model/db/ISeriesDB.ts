import RecordedSeriesLink, { SeriesAirType } from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import SeriesAlias from '../../db/entities/SeriesAlias';
import SeriesChangeHistory, { SeriesChangeAction } from '../../db/entities/SeriesChangeHistory';
import SeriesEpisode from '../../db/entities/SeriesEpisode';
import SeriesPendingMatch from '../../db/entities/SeriesPendingMatch';
import SeriesReservationHint from '../../db/entities/SeriesReservationHint';
export interface NewSeries {
    title: string;
    normalizedTitle: string;
    preferredChannelId: number | null;
    // しょぼいカレンダー作品辞書で確定した場合の TID
    syobocalTid?: number | null;
    createdAt: number;
    updatedAt: number;
}
export interface NewEpisode {
    seriesId: number;
    seasonNumber: number;
    episodeNumber: number | null;
    episodeLabel: string | null;
    title: null;
    airedAt: number | null;
    createdAt: number;
    updatedAt: number;
}
export interface SaveSeriesLink {
    recordedId: number;
    seriesId: number;
    channelId: number;
    episodeId: number | null;
    airType: RecordedSeriesLink['airType'];
    matchMethod: RecordedSeriesLink['matchMethod'];
    confidence: number;
    manualLock: boolean;
    createdAt: number;
    updatedAt: number;
}
export interface SeriesRecordedRow {
    recordedId: number;
    channelId: number;
    channelName: string | null;
    recordedTitle: string;
    startAt: number;
    endAt: number;
    episodeId: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    episodeLabel: string | null;
    episodeTitle: string | null;
    airType: string;
    confidence: number;
}
export interface SeriesChannelRow {
    channelId: number;
    channelName: string | null;
    count: number;
}
export interface PendingCandidate {
    seriesId: number;
    seriesTitle: string;
    score: number;
}
export interface NewPendingMatch {
    recordedId: number;
    normalizedTitle: string;
    channelId: number;
    candidates: PendingCandidate[];
    createdAt: number;
}
export interface NewHistory {
    recordedId: number;
    action: SeriesChangeAction;
    previous: RecordedSeriesLink | null;
    createdAt: number;
}
export interface NewReservationHint {
    reserveId: number;
    seriesId: number;
    episodeId: number;
    airType: SeriesAirType;
    createdAt: number;
}
export default interface ISeriesDB {
    findCandidates(normalizedTitle: string): Promise<Series[]>;
    /**
     * しょぼいカレンダーの TID からシリーズを引く (作品辞書で確定した録画を同一シリーズへ寄せるために使う)
     * @param syobocalTid: number
     * @return Promise<Series | null>
     */
    findBySyobocalTid(syobocalTid: number): Promise<Series | null>;
    createSeries(value: NewSeries): Promise<Series>;
    findEpisode(seriesId: number, seasonNumber: number, episodeNumber: number | null): Promise<SeriesEpisode | null>;
    findEpisodeById(id: number): Promise<SeriesEpisode | null>;
    createEpisode(value: NewEpisode): Promise<SeriesEpisode>;
    findLink(recordedId: number): Promise<RecordedSeriesLink | null>;
    saveLink(value: SaveSeriesLink): Promise<RecordedSeriesLink>;
    list(keyword: string | undefined, offset: number, limit: number): Promise<[Series[], number]>;
    getSeries(id: number): Promise<Series | null>;
    listRecorded(seriesId: number, channelId?: number): Promise<SeriesRecordedRow[]>;
    listChannels(seriesId: number): Promise<SeriesChannelRow[]>;
    deleteLink(recordedId: number): Promise<void>;
    countOtherLinksByEpisode(episodeId: number, recordedId: number): Promise<number>;
    updateExternalMetadata(id: number, value: { annictId?: string | null; syobocalTid?: number | null }): Promise<void>;

    // --- 未確定キュー (S9 §4.5) ---
    upsertPendingMatch(value: NewPendingMatch): Promise<SeriesPendingMatch>;
    listPendingMatches(offset: number, limit: number): Promise<[SeriesPendingMatch[], number]>;
    getPendingMatch(id: number): Promise<SeriesPendingMatch | null>;
    findPendingMatchByRecordedId(recordedId: number): Promise<SeriesPendingMatch | null>;
    deletePendingMatchByRecordedId(recordedId: number): Promise<void>;
    deletePendingMatch(id: number): Promise<void>;

    // --- エイリアス辞書 (S11 §4.8) ---
    findAlias(normalizedTitle: string): Promise<SeriesAlias | null>;
    upsertAlias(normalizedTitle: string, seriesId: number, createdAt: number): Promise<SeriesAlias>;
    listAlias(seriesId?: number): Promise<SeriesAlias[]>;
    deleteAlias(id: number): Promise<void>;

    // --- 変更履歴 / Undo (S11 §4.8) ---
    addHistory(value: NewHistory): Promise<SeriesChangeHistory>;
    getHistory(id: number): Promise<SeriesChangeHistory | null>;
    getLatestHistoryForRecorded(recordedId: number): Promise<SeriesChangeHistory | null>;
    markHistoryUndone(id: number): Promise<void>;

    // --- マージ / 分割 (S11 §4.8) ---
    /**
     * fromSeriesId のリンク・エピソード・エイリアスを toSeriesId へ付け替え、fromSeriesId を削除する
     * @return 移動したリンク数
     */
    mergeSeries(fromSeriesId: number, toSeriesId: number): Promise<number>;
    /**
     * recordedIds のリンクを新しいシリーズへ分割する (episodeId は分割後クリアされる)
     * @return 作成された新シリーズ
     */
    splitSeries(sourceSeriesId: number, recordedIds: number[], newTitle: string): Promise<Series>;

    // --- バックアップ / リストア (DBTools 用) ---
    findAllSeries(): Promise<Series[]>;
    findAllEpisodes(): Promise<SeriesEpisode[]>;
    findAllLinks(): Promise<RecordedSeriesLink[]>;
    findAllAliases(): Promise<SeriesAlias[]>;
    findAllPendingMatches(): Promise<SeriesPendingMatch[]>;
    findAllHistories(): Promise<SeriesChangeHistory[]>;
    restoreSeries(items: Series[]): Promise<void>;
    restoreEpisodes(items: SeriesEpisode[]): Promise<void>;
    restoreLinks(items: RecordedSeriesLink[]): Promise<void>;
    restoreAliases(items: SeriesAlias[]): Promise<void>;
    restorePendingMatches(items: SeriesPendingMatch[]): Promise<void>;
    restoreHistories(items: SeriesChangeHistory[]): Promise<void>;

    // --- 補完予約提案の airType ヒント (§4.7) ---
    /**
     * 欠番補完予約提案から予約を作成した際に、録画完了時点で使う airType のヒントを保存する
     */
    saveReservationHint(value: NewReservationHint): Promise<SeriesReservationHint>;
    findReservationHintByReserveId(reserveId: number): Promise<SeriesReservationHint | null>;
    deleteReservationHint(id: number): Promise<void>;
}
