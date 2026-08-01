import RecordedSeriesLink, { SeriesAirType } from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import SeriesAlias from '../../db/entities/SeriesAlias';
import SeriesChangeHistory, { SeriesChangeAction } from '../../db/entities/SeriesChangeHistory';
import SeriesEpisode from '../../db/entities/SeriesEpisode';
import SeriesPendingMatch from '../../db/entities/SeriesPendingMatch';
import SeriesReservationHint from '../../db/entities/SeriesReservationHint';
export interface NewSeries {
    title: string;
    // 表示名の出所 ('dictionary': 作品辞書の正式タイトル / 'manual': 手動設定)
    titleSource?: string | null;
    normalizedTitle: string;
    preferredChannelId: number | null;
    // 作品辞書で確定した場合の しょぼいカレンダー TID
    syobocalTid?: number | null;
    // 作品辞書で確定した場合の Annict 作品 ID
    annictId?: string | null;
    // 全ジャンル番組辞書 (Wikidata) で確定した場合の項目 ID
    wikidataQid?: string | null;
    // Wikidata 経由で判明した TMDb テレビシリーズ ID
    tmdbId?: number | null;
    // 読み仮名 (あいうえお順の並べ替え用)
    titleKana?: string | null;
    // 放送クール
    seasonYear?: number | null;
    seasonName?: string | null;
    // 放送予定総話数
    totalEpisodes?: number | null;
    createdAt: number;
    updatedAt: number;
}
export interface NewEpisode {
    seriesId: number;
    seasonNumber: number;
    episodeNumber: number | null;
    episodeLabel: string | null;
    // 作品辞書 (しょぼいカレンダー) から引けたサブタイトル。引けなければ null
    title: string | null;
    // 放送予定から引けた放送回コメント (省略可)
    comment?: string | null;
    // コメントの出所 ('dictionary' | 'manual')。コメントが無ければ null
    commentSource?: string | null;
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
    // 放送回コメント (しょぼいカレンダーの ProgComment 由来、または手動編集)
    episodeComment: string | null;
    // 放送回コメントの出所 ('dictionary' | 'manual')
    episodeCommentSource: string | null;
    airType: string;
    confidence: number;
}
/**
 * 録画 1 件に紐づくシリーズ・エピソードの表示用情報 (一覧のタイトル表示に使う)
 */
export interface RecordedSeriesInfo {
    seriesId: number;
    seriesTitle: string;
    seasonNumber: number | null;
    episodeNumber: number | null;
    episodeLabel: string | null;
    episodeTitle: string | null;
    episodeComment: string | null;
    episodeCommentSource: string | null;
    airType: string;
}

export type SeriesSortKey = 'updatedAt' | 'title' | 'firstAiredAt' | 'lastAiredAt' | 'recordedCount' | 'totalFileSize';
export type SeriesStatusFilter = 'onair' | 'finished';
// シリーズの出所。'dictionary': 作品辞書 (しょぼいカレンダー / Annict / Wikidata) 由来の外部 ID を持つ / 'local': 録画タイトルから作られた
export type SeriesOriginFilter = 'dictionary' | 'local';

export interface SeriesListQuery {
    keyword?: string;
    offset: number;
    limit: number;
    sort: SeriesSortKey;
    order: 'asc' | 'desc';
    seasonYear?: number;
    seasonName?: string;
    // 'onair': 直近に録画があり完結していない / 'finished': 総話数に到達済み、または一定期間録画が無い
    status?: SeriesStatusFilter;
    // 'dictionary': 外部辞書起点のシリーズのみ / 'local': 録画タイトルから作られたシリーズのみ
    origin?: SeriesOriginFilter;
    // 放送中とみなす最終録画からの経過時間 (ms)。status の判定に使う
    onairWithinMs: number;
}

export interface SeriesListRow {
    series: Series;
    recordedCount: number;
    totalFileSize: number;
    firstAiredAt: number | null;
    lastAiredAt: number | null;
    unwatchedCount: number;
}

export interface SeriesSeasonRow {
    seasonYear: number;
    seasonName: string;
    count: number;
}

/**
 * 録画が紐づいていないシリーズ 1 件 (削除候補)
 */
export interface EmptySeriesRow {
    series: Series;
    // このシリーズを指しているエイリアス辞書の件数 (シリーズと一緒に消える)
    aliasCount: number;
    // このシリーズに登録されているエピソード数 (シリーズと一緒に消える)
    episodeCount: number;
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
    /**
     * Annict 作品 ID からシリーズを引く (しょぼいカレンダー未収録の作品を同一シリーズへ寄せるために使う)
     * @param annictId: string
     * @return Promise<Series | null>
     */
    findByAnnictId(annictId: string): Promise<Series | null>;
    /**
     * Wikidata 項目 ID からシリーズを引く (アニメ辞書に無い番組を同一シリーズへ寄せるために使う)
     * @param wikidataQid: string
     * @return Promise<Series | null>
     */
    findByWikidataQid(wikidataQid: string): Promise<Series | null>;
    createSeries(value: NewSeries): Promise<Series>;
    findEpisode(seriesId: number, seasonNumber: number, episodeNumber: number | null): Promise<SeriesEpisode | null>;
    findEpisodeById(id: number): Promise<SeriesEpisode | null>;
    /**
     * 録画 ID の一覧に対応するシリーズ・エピソード情報をまとめて引く (一覧表示で N+1 にしない)
     * @param recordedIds: number[]
     * @return Promise<Map<number, RecordedSeriesInfo>> シリーズに紐づいていない録画はキーごと含まれない
     */
    findSeriesInfoByRecordedIds(recordedIds: number[]): Promise<Map<number, RecordedSeriesInfo>>;
    createEpisode(value: NewEpisode): Promise<SeriesEpisode>;
    /**
     * エピソードのサブタイトル・放送回コメントを作品辞書の値で補完する。
     * 手動編集で入った値を消さないよう、現在 null の項目にのみ書き込む
     * @param episodeId: number
     * @param value: 補完する項目 (省略した項目は触らない)
     * @param updatedAt: number
     * @return Promise<void>
     */
    fillEpisodeMetadata(
        episodeId: number,
        value: { title?: string | null; comment?: string | null },
        updatedAt: number,
    ): Promise<void>;
    /**
     * エピソードの放送回コメントを手動で設定する (null で削除)。
     * 手動設定した値は以後の自動補完で上書きされない
     * @param episodeId: number
     * @param comment: string | null
     * @param updatedAt: number
     * @return Promise<boolean> 対象のエピソードが無ければ false
     */
    updateEpisodeComment(episodeId: number, comment: string | null, updatedAt: number): Promise<boolean>;
    /**
     * シリーズの作品コメントを設定する
     * @param seriesId: number
     * @param comment: string | null
     * @param source: 'dictionary' | 'manual' 出所 ('manual' は自動補完で上書きされない)
     * @param updatedAt: number
     * @return Promise<boolean> 対象のシリーズが無ければ false
     */
    updateSeriesComment(
        seriesId: number,
        comment: string | null,
        source: 'dictionary' | 'manual',
        updatedAt: number,
    ): Promise<boolean>;
    findLink(recordedId: number): Promise<RecordedSeriesLink | null>;
    saveLink(value: SaveSeriesLink): Promise<RecordedSeriesLink>;
    list(keyword: string | undefined, offset: number, limit: number): Promise<[Series[], number]>;
    /**
     * 並べ替え・絞り込み付きでシリーズ一覧を取得する。
     * 録画件数・容量・初回/最終放送日時・未視聴数は 1 クエリで集計する (一覧で N+1 にしない)
     * @param option: SeriesListQuery
     * @return Promise<[SeriesListRow[], number]> 行と総件数
     */
    query(option: SeriesListQuery): Promise<[SeriesListRow[], number]>;
    /**
     * 正規化タイトルが指定の接頭辞で始まるシリーズを返す (マージ候補の前方一致検索用)
     * @param prefix: string 正規化済みの接頭辞。空文字の場合は空配列を返す
     * @param limit: number 最大件数
     * @param excludeSeriesId?: number 除外するシリーズ ID (マージ元自身)
     * @return Promise<Series[]>
     */
    findByNormalizedTitlePrefix(prefix: string, limit: number, excludeSeriesId?: number): Promise<Series[]>;
    /**
     * 一覧に出ているシリーズ群の録画行をまとめて取得する (欠番・重複判定用)
     * @param seriesIds: number[]
     * @return Promise<Map<number, SeriesRecordedRow[]>>
     */
    listRecordedForSeriesIds(seriesIds: number[]): Promise<Map<number, SeriesRecordedRow[]>>;
    /**
     * 登録されているクールの一覧を新しい順で返す (絞り込み UI の選択肢用)
     * @return Promise<SeriesSeasonRow[]>
     */
    listSeasons(): Promise<SeriesSeasonRow[]>;
    /**
     * シリーズごとの最古の録画開始日時を 1 クエリでまとめて引く (クール推測用)
     * @return Promise<Map<number, number>> シリーズ ID → 最古の startAt
     */
    findFirstAiredAtMap(): Promise<Map<number, number>>;
    getSeries(id: number): Promise<Series | null>;
    listRecorded(seriesId: number, channelId?: number): Promise<SeriesRecordedRow[]>;
    listChannels(seriesId: number): Promise<SeriesChannelRow[]>;
    /**
     * 複数シリーズについて、代表となる録画サムネイルの相対パスを 1 クエリでまとめて引く
     * (一覧表示でシリーズごとに問い合わせると N+1 になるため)
     * @param seriesIds: number[]
     * @return Promise<Map<number, string>> シリーズ ID → thumbnail.filePath
     */
    findThumbnailPaths(seriesIds: number[]): Promise<Map<number, string>>;
    deleteLink(recordedId: number): Promise<void>;
    countOtherLinksByEpisode(episodeId: number, recordedId: number): Promise<number>;
    updateExternalMetadata(
        id: number,
        value: {
            title?: string;
            titleSource?: string | null;
            annictId?: string | null;
            syobocalTid?: number | null;
            wikidataQid?: string | null;
            tmdbId?: number | null;
            titleKana?: string | null;
            seasonYear?: number | null;
            seasonName?: string | null;
            seasonSource?: string | null;
            totalEpisodes?: number | null;
        },
    ): Promise<void>;

    // --- 未確定キュー (S9 §4.5) ---
    upsertPendingMatch(value: NewPendingMatch): Promise<SeriesPendingMatch>;
    listPendingMatches(offset: number, limit: number): Promise<[SeriesPendingMatch[], number]>;
    getPendingMatch(id: number): Promise<SeriesPendingMatch | null>;
    findPendingMatchByRecordedId(recordedId: number): Promise<SeriesPendingMatch | null>;
    deletePendingMatchByRecordedId(recordedId: number): Promise<void>;
    deletePendingMatch(id: number): Promise<void>;

    // --- エイリアス辞書 (S11 §4.8) ---
    findAlias(normalizedTitle: string): Promise<SeriesAlias | null>;
    /**
     * エイリアス辞書へ「正規化タイトル → シリーズ」の対応を記録する
     * @param normalizedTitle: string
     * @param seriesId: number
     * @param createdAt: number
     * @param source: string 学習元 ('manual': 手動修正 / 'llm': LLM 抽出 + 検証済み)
     * @return Promise<SeriesAlias>
     */
    upsertAlias(normalizedTitle: string, seriesId: number, createdAt: number, source?: string): Promise<SeriesAlias>;
    listAlias(seriesId?: number): Promise<SeriesAlias[]>;
    /**
     * ID を指定してエイリアス 1 件を取得する
     * @param id: number
     * @return Promise<SeriesAlias | null>
     */
    getAlias(id: number): Promise<SeriesAlias | null>;
    /**
     * エイリアスの付け替え先シリーズと学習元を更新する (正規化タイトルは変えない)
     * @param id: number
     * @param seriesId: number 付け替え先
     * @param source: string 学習元 ('manual' / 'llm')
     * @return Promise<SeriesAlias>
     */
    updateAlias(id: number, seriesId: number, source: string): Promise<SeriesAlias>;
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

    // --- 空シリーズの掃除 ---
    /**
     * 録画が 1 件も紐づいていないシリーズを列挙する。
     * マージ・分割・録画削除の結果取り残された自動生成シリーズを掛けるために使う
     * @return Promise<EmptySeriesRow[]> 更新日時の新しい順
     */
    listEmptySeries(): Promise<EmptySeriesRow[]>;
    /**
     * シリーズをエピソード・エイリアス辞書・予約ヒントごと削除する。
     * 録画が紐づいているシリーズは誤削除を防ぐためスキップする
     * @param ids: number[] 削除対象のシリーズ ID
     * @return Promise<number> 実際に削除したシリーズ数
     */
    deleteSeriesByIds(ids: number[]): Promise<number>;

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
