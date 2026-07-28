export type UnixtimeMS = number;

export type ChannelId = number;
export type ServiceId = number;
export type NetworkId = number;
export type ProgramId = number;
export type EventId = number;
export type RuleId = number;
export type ReserveId = number;
export type RecordedId = number;
export type RecordedHistoryId = number;
export type VideoFileId = number;
export type VideoFileType = 'ts' | 'encoded';
export type WatchStatus = 'unwatched' | 'watching' | 'watched';
export type ThumbnailId = number;
export type DropLogFileId = number;
export type RecordedTagId = number;
export type SavedSearchId = number;
export type EncodeId = number;
export type ChannelType =
    | 'GR'
    | 'BS'
    | 'CS'
    | 'SKY'
    | 'NW1'
    | 'NW2'
    | 'NW3'
    | 'NW4'
    | 'NW5'
    | 'NW6'
    | 'NW7'
    | 'NW8'
    | 'NW9'
    | 'NW10'
    | 'NW11'
    | 'NW12'
    | 'NW13'
    | 'NW14'
    | 'NW15'
    | 'NW16'
    | 'NW17'
    | 'NW18'
    | 'NW19'
    | 'NW20'
    | 'NW21'
    | 'NW22'
    | 'NW23'
    | 'NW24'
    | 'NW25'
    | 'NW26'
    | 'NW27'
    | 'NW28'
    | 'NW29'
    | 'NW30'
    | 'NW31'
    | 'NW32'
    | 'NW33'
    | 'NW34'
    | 'NW35'
    | 'NW36'
    | 'NW37'
    | 'NW38'
    | 'NW39'
    | 'NW40'; // NWを追加
export type ProgramGenreLv1 = number;
export type ProgramGenreLv2 = number;
export type ProgramVideoType = 'mpeg2' | 'h.264' | 'h.265';
export type ProgramVideoResolution = '240p' | '480i' | '480p' | '720p' | '1080i' | '2160p' | '4320p';
export type ProgramAudioSamplingRate = 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
export type RawExtended = { [description: string]: string };
export type StreamId = number;
export type StreamType = 'LiveStream' | 'LiveHLS' | 'RecordedStream' | 'RecordedHLS';

/**
 * チャンネル情報
 */
export interface ChannelItem {
    id: ChannelId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    halfWidthName: string;
    remoteControlKeyId?: number;
    hasLogoData: boolean;
    channelType: ChannelType;
    channel: string;
    type?: number;
}

/**
 * 手動予約編集オプション
 */
export interface EditManualReserveOption {
    allowEndLack: boolean; // 末尾切れを許すか
    tags?: RecordedTagId[];
    saveOption?: ReserveSaveOption;
    encodeOption?: ReserveEncodedOption;
}

/**
 * 手動予約オプション
 */
export interface ManualReserveOption extends EditManualReserveOption {
    programId?: ProgramId; // program ID undefined の場合は時刻指定予約
    timeSpecifiedOption?: {
        name: string;
        channelId: ChannelId;
        startAt: UnixtimeMS;
        endAt: UnixtimeMS;
    };
}

/**
 * 予約情報取得タイプ
 */
export type GetReserveType = 'all' | 'normal' | 'conflict' | 'skip' | 'overlap';

/**
 * 予約情報取得オプション
 */
export interface GetReserveOption {
    type?: GetReserveType;
    isHalfWidth: boolean;
    ruleId?: RuleId;
    offset?: number;
    limit?: number;
}

/**
 * 予約情報
 */
export interface Reserves {
    reserves: ReserveItem[];
    total: number;
}

/**
 * 予約番組情報
 */
export interface ReserveItem {
    /**
     * 予約情報
     */
    id: ReserveId;
    ruleId?: RuleId;
    isSkip: boolean;
    isConflict: boolean;
    isOverlap: boolean;
    allowEndLack: boolean;
    isTimeSpecified: boolean;
    tags?: RecordedTagId[];
    /**
     * 保存オプション
     */
    parentDirectoryName?: string;
    directory?: string;
    recordedFormat?: string;
    /**
     * エンコード情報
     */
    encodeMode1?: string;
    encodeParentDirectoryName1?: string;
    encodeDirectory1?: string;
    encodeMode2?: string;
    encodeParentDirectoryName2?: string;
    encodeDirectory2?: string;
    encodeMode3?: string;
    encodeParentDirectoryName3?: string;
    encodeDirectory3?: string;
    isDeleteOriginalAfterEncode: boolean;
    /**
     * 番組情報
     */
    programId?: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
}

/**
 * 予約情報のリスト取得オプション
 */
export interface GetReserveListsOption {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
}

/**
 * 予約情報のリスト
 * 予約, 除外, 重複, 競合の reserveId リスト
 */
export interface ReserveLists {
    normal: ReserveListItem[];
    conflicts: ReserveListItem[];
    skips: ReserveListItem[];
    overlaps: ReserveListItem[];
}

/**
 * 予約リストitem
 */
export interface ReserveListItem {
    reserveId: ReserveId;
    programId?: ProgramId;
    ruleId?: RuleId;
}

export interface ReserveCnts {
    normal: number;
    conflicts: number;
    skips: number;
    overlaps: number;
}

/**
 * 放送波の状態
 * true のもが有効
 */
export interface BroadcastStatus {
    GR: boolean;
    BS: boolean;
    CS: boolean;
    SKY: boolean;
    NW1: boolean;
    NW2: boolean;
    NW3: boolean;
    NW4: boolean;
    NW5: boolean;
    NW6: boolean;
    NW7: boolean;
    NW8: boolean;
    NW9: boolean;
    NW10: boolean;
    NW11: boolean;
    NW12: boolean;
    NW13: boolean;
    NW14: boolean;
    NW15: boolean;
    NW16: boolean;
    NW17: boolean;
    NW18: boolean;
    NW19: boolean;
    NW20: boolean;
    NW21: boolean;
    NW22: boolean;
    NW23: boolean;
    NW24: boolean;
    NW25: boolean;
    NW26: boolean;
    NW27: boolean;
    NW28: boolean;
    NW29: boolean;
    NW30: boolean;
    NW31: boolean;
    NW32: boolean;
    NW33: boolean;
    NW34: boolean;
    NW35: boolean;
    NW36: boolean;
    NW37: boolean;
    NW38: boolean;
    NW39: boolean;
    NW40: boolean;
}

/**
 * Rule
 */
export interface Rule extends AddRuleOption {
    id: RuleId;
    reservesCnt?: number;
}

export interface RuleKeywordItem {
    id: RuleId;
    keyword: string;
}

/**
 * ルールのキーワード検索結果
 */
export interface RuleKeywordInfo {
    items: RuleKeywordItem[];
}

/**
 * Rule 追加オプション
 */
export interface AddRuleOption {
    isTimeSpecification: boolean;
    searchOption: RuleSearchOption;
    reserveOption: RuleReserveOption;
    saveOption?: ReserveSaveOption;
    encodeOption?: ReserveEncodedOption;
}

/**
 * ジャンル
 */
export interface Genre {
    genre: ProgramGenreLv1;
    subGenre?: ProgramGenreLv2;
}

/**
 * 時刻指定
 * program id 予約の場合は動画の長さ
 * 時刻指定予約の場合は時刻範囲 (0 ~  60 * 24)
 */
export interface SearchTime {
    // program id 予約の場合は 0 ~ 23 時の開始時刻を指定する
    // 時刻予約の場合は 0 時を 0 とした 0 ~ (60 * 50 * 24) - 1 秒までの開始時刻を指定する
    start?: number;
    // program id 予約の場合は 1 ~ 23 時間の長さを指定する
    // 時刻予約の場合は秒で時間の長さを指定する 1 ~ 60 * 50 * 24 秒
    range?: number;
    // 曜日指定 0x01, 0x02, 0x04, 0x08, 0x10, 0x20 ,0x40 が日〜土に対応するので and 演算で曜日を指定する
    week: number;
}

/**
 * 検索期間指定
 */
export interface SearchPeriod {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
}

/**
 * Rule 検索オプション
 */
export interface RuleSearchOption {
    keyword?: string; // 検索キーワード
    ignoreKeyword?: string; // 除外検索キーワード
    keyCS?: boolean; // 大文字小文字区別有効化 (検索キーワード)
    keyRegExp?: boolean; // 正規表現 (検索キーワード)
    name?: boolean; // 番組名 (検索キーワード)
    description?: boolean; // 概要 (検索キーワード)
    extended?: boolean; // 詳細 (検索キーワード)
    ignoreKeyCS?: boolean; // 大文字小文字区別有効化 (除外検索キーワード)
    ignoreKeyRegExp?: boolean; // 正規表現 (除外検索キーワード)
    ignoreName?: boolean; // 番組名 (除外検索キーワード)
    ignoreDescription?: boolean; // 概要 (除外検索キーワード)
    ignoreExtended?: boolean; // 詳細 (除外検索キーワード)
    GR?: boolean; // GR
    BS?: boolean; // BS
    CS?: boolean; // CS
    SKY?: boolean; // SKY
    NW1?: boolean; // NW
    NW2?: boolean; // NW
    NW3?: boolean; // NW
    NW4?: boolean; // NW
    NW5?: boolean; // NW
    NW6?: boolean; // NW
    NW7?: boolean; // NW
    NW8?: boolean; // NW
    NW9?: boolean; // NW
    NW10?: boolean; // NW
    NW11?: boolean; // NW
    NW12?: boolean; // NW
    NW13?: boolean; // NW
    NW14?: boolean; // NW
    NW15?: boolean; // NW
    NW16?: boolean; // NW
    NW17?: boolean; // NW
    NW18?: boolean; // NW
    NW19?: boolean; // NW
    NW20?: boolean; // NW
    NW21?: boolean; // NW
    NW22?: boolean; // NW
    NW23?: boolean; // NW
    NW24?: boolean; // NW
    NW25?: boolean; // NW
    NW26?: boolean; // NW
    NW27?: boolean; // NW
    NW28?: boolean; // NW
    NW29?: boolean; // NW
    NW30?: boolean; // NW
    NW31?: boolean; // NW
    NW32?: boolean; // NW
    NW33?: boolean; // NW
    NW34?: boolean; // NW
    NW35?: boolean; // NW
    NW36?: boolean; // NW
    NW37?: boolean; // NW
    NW38?: boolean; // NW
    NW39?: boolean; // NW
    NW40?: boolean; // NW
    channelIds?: ChannelId[]; // channels ids
    genres?: Genre[];
    times?: SearchTime[]; // 開始時間からの有効時間
    isFree?: boolean; // 無料放送か
    durationMin?: number; // 番組最小時間
    durationMax?: number; // 番組最大時間
    searchPeriods?: SearchPeriod[]; // 検索対象期間
}

/**
 * ルール予約オプション
 */
export interface RuleReserveOption {
    enable: boolean; // ルールが有効か
    allowEndLack: boolean; // 末尾切れを許可するか
    avoidDuplicate: boolean; // 録画済みの重複番組を排除するか
    periodToAvoidDuplicate?: number; // 重複を避ける期間
    tags?: RecordedTagId[]; // 録画完了後に付与する tag 設定
}

/**
 * 保存オプション
 */
export interface ReserveSaveOption {
    parentDirectoryName?: string; // 親保存ディレクトリ
    directory?: string; // 保存ディレクトリ
    recordedFormat?: string; // ファイル名フォーマット
}

/**
 * エンコードオプション
 */
export interface ReserveEncodedOption {
    mode1?: string; // エンコードモード
    encodeParentDirectoryName1?: string; // 親保存ディレクトリ
    directory1?: string; // 保存先ディレクトリ
    mode2?: string;
    encodeParentDirectoryName2?: string;
    directory2?: string;
    mode3?: string;
    encodeParentDirectoryName3?: string;
    directory3?: string;
    isDeleteOriginalAfterEncode: boolean;
}

/**
 * ルール情報
 */
export interface Rules {
    rules: Rule[];
    total: number;
}

/**
 * ルール情報取得オプション
 */
export interface GetRuleOption {
    offset?: number;
    limit?: number;
    type?: GetReserveType;
    keyword?: string;
}

/**
 * 録画一覧情報
 */
export interface Records {
    records: RecordedItem[];
    total: number;
}

/**
 * Recorded
 */
export interface RecordedItem {
    id: RecordedId;
    ruleId?: RuleId;
    programId?: ProgramId;
    channelId: ChannelId;
    channelName?: string; // 録画時点の放送局名 (channel テーブルから放送局情報が失われた場合の表示用)
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
    isRecording: boolean;
    thumbnails?: ThumbnailId[];
    videoFiles?: VideoFile[];
    dropLogFile?: DropLogFile;
    tags?: RecordedTag[];
    isEncoding: boolean;
    isProtected: boolean;
}

/**
 * VideoFile
 */
export interface VideoFile {
    id: VideoFileId;
    name: string;
    filename: string;
    type: VideoFileType;
    size: number;
    watchHistory?: WatchHistory;
}

export interface DashboardData {
    recording: Records;
    recentlyRecorded: Records;
    upcomingReserves: Reserves;
    reserveCounts: ReserveCnts;
}

export interface WatchHistory {
    videoFileId: VideoFileId;
    recordedId: RecordedId;
    position: number;
    duration: number;
    status: WatchStatus;
    updatedAt: UnixtimeMS;
}
export interface UpdatePlaybackPositionOption {
    position: number;
    duration: number;
}

export interface DropLogFile {
    id: DropLogFileId;
    errorCnt: number;
    dropCnt: number;
    scramblingCnt: number;
}

/**
 * Recorded tag
 */
export interface RecordedTag {
    id: RecordedTagId;
    name: string;
    color: string;
    parentId?: number | null;
}

export interface RecordedTags {
    tags: RecordedTag[];
    total: number;
}

/**
 * recorded 取得オプション
 */
export interface GetRecordedOption {
    isHalfWidth: boolean;
    offset?: number;
    limit?: number;
    isReverse?: boolean;
    ruleId?: RuleId;
    channelId?: ChannelId;
    genre?: ProgramGenreLv1;
    keyword?: string;
    hasOriginalFile?: boolean;
    tagId?: RecordedTagId;
}

/**
 * recorded が持つ channelId のリスト
 */
export interface RecordedChannelListItem {
    cnt: number; // 個数
    channelId: ChannelId; // 放送局 id
}

/**
 * recorded が持つ genre のリスト
 */
export interface RecordedGenreListItem {
    cnt: number; // 個数
    genre: ProgramGenreLv1; // ジャンル
}

/**
 * recorded が持つ検索オプションリスト
 */
export interface RecordedSearchOptions {
    channels: RecordedChannelListItem[];
    genres: RecordedGenreListItem[];
}

/**
 * クリーンアップ実行時の対象指定 (省略時は 'all')
 * all: 録画ファイル + ドロップログファイルの両方をクリーンアップする
 * dropLogOnly: ドロップログファイルのみをクリーンアップする (録画実ファイルは削除しない)
 */
export type RecordedCleanupTarget = 'all' | 'dropLogOnly';

/**
 * クリーンアップ実行オプション
 */
export interface RecordedCleanupOption {
    target?: RecordedCleanupTarget; // 省略時は 'all'
}

/**
 * DB 未登録の動画実ファイルの削除候補情報
 */
export interface RecordedCleanupFileCandidates {
    count: number; // 削除候補件数
    sampleFilePaths: string[]; // 代表ファイルパス (先頭数件)
    totalSize?: number; // 削除候補の合計サイズ (byte)
}

/**
 * DB 未登録のドロップログファイルの削除候補情報
 */
export interface RecordedCleanupDropLogCandidates {
    count: number; // 削除候補件数
    sampleFilePaths: string[]; // 代表ファイルパス (先頭数件)
}

/**
 * クリーンアップ削除候補情報 (dry-run 結果)
 */
export interface RecordedCleanupInfo {
    videoFiles: RecordedCleanupFileCandidates;
    dropLogs: RecordedCleanupDropLogCandidates;
}

/**
 * tag 取得オプション
 */
export interface GetRecordedTagOption {
    offset?: number;
    limit?: number;
    name?: string;
    excludeTagId?: RecordedTagId[];
}

/**
 * 保存検索 (advancedSearch 機能フラグ有効時のみ利用可能)
 */
export interface SavedSearchItem {
    id: SavedSearchId;
    name: string;
    query: string;
    isPinned: boolean;
    createdAt: UnixtimeMS;
    updatedAt: UnixtimeMS;
}

export interface SavedSearchItems {
    items: SavedSearchItem[];
    total: number;
}

export interface AddSavedSearchOption {
    name: string;
    query: string;
    isPinned?: boolean;
}

export interface UpdateSavedSearchOption {
    name: string;
    query: string;
    isPinned?: boolean;
}

export interface AddedSavedSearch {
    searchId: SavedSearchId;
}

/**
 * URL Scheme 情報
 */
export interface URLSchemeInfo {
    ios?: string;
    android?: string;
    mac?: string;
    win?: string;
}

export interface M2TSStreamParam {
    name: string;
    isUnconverted: boolean; // 無変換か
}

// 配信コンテナ種別 (LL-HLS は別フェーズで追加予定のためまだ含めない)
export type StreamContainer = 'm2ts' | 'm2tsll' | 'mp4' | 'webm' | 'hls';

export interface StreamVideoParam {
    codec?: string;
    width?: number;
    height?: number;
    bitrate?: number; // kbps
}

export interface StreamAudioParam {
    codec?: string;
    bitrate?: number; // kbps
}

/**
 * クライアントへ公開する id ベースの配信プリセット情報 (cmd は含まない)
 */
export interface ClientStreamProfile {
    id: string;
    name: string;
    container: StreamContainer;
    video?: StreamVideoParam;
    audio?: StreamAudioParam;
    isUnconverted?: boolean;
}

/**
 * クライアントへ公開する id ベースのエンコードプリセット情報 (cmd は含まない)
 */
export interface ClientEncodePreset {
    id: string;
    name: string;
    video?: StreamVideoParam;
    audio?: StreamAudioParam;
}

/**
 * 外部サービスとの接続状態
 */
export interface Status {
    mirakurun: {
        isAlive: boolean; // mirakurun へ接続できているか
        checkedAt: UnixtimeMS; // 接続確認を行った時刻
    };
}

/**
 * ログの出力元プロセス
 */
export type LogProcessType = 'Operator' | 'Service' | 'EPGUpdater';

/**
 * ログファイル情報
 */
export interface LogFileItem {
    id: string;
    process: LogProcessType;
    category: string;
    name: string;
    size: number;
    updatedAt: UnixtimeMS;
    isRotated: boolean;
}

/**
 * ログファイル一覧
 */
export interface LogFiles {
    items: LogFileItem[];
}

/**
 * ログファイルの内容
 */
export interface LogFileContent {
    id: string;
    process: LogProcessType;
    category: string;
    name: string;
    size: number;
    updatedAt: UnixtimeMS;
    isTruncated: boolean;
    lines: string[];
}

/**
 * クライアントが受け取る設定情報
 */
export interface Config {
    socketIOPort: number;
    broadcast: BroadcastStatus;
    recorded: string[];
    encode: string[];
    urlscheme: {
        m2ts: URLSchemeInfo;
        video: URLSchemeInfo;
        download: URLSchemeInfo;
    };
    isEnableTSLiveStream: boolean;
    isEnableTSRecordedStream: boolean;
    isEnableEncodedRecordedStream: boolean;
    streamConfig?: {
        live?: {
            ts?: {
                m2ts?: M2TSStreamParam[];
                m2tsll?: string[];
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
        };
        recorded?: {
            ts?: {
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
            encoded?: {
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
        };
    };
    // id ベースの配信プリセット情報 (新形式)。streamConfig と併存 (クライアント未移行のため streamConfig は維持)
    streamProfiles?: {
        live?: ClientStreamProfile[];
        recorded?: {
            ts?: ClientStreamProfile[];
            encoded?: ClientStreamProfile[];
        };
    };
    // id ベースのエンコードプリセット情報 (新形式)。encode と併存 (クライアント未移行のため encode は維持)
    encodePresets?: ClientEncodePreset[];
    kodiHosts?: string[];
    // 段階導入用の機能フラグ。クライアントはこれを見て機能の表示可否を判断する
    featureFlags?: FeatureFlags;
    // 外部録画ファイル取り込みが許可されたディレクトリ名一覧 (featureFlags.externalFileImport が有効な場合のみ意味を持つ)
    importDirs?: string[];
}

/**
 * 段階導入用の機能フラグ
 * サーバ側の FEATURE_FLAG_KEYS (src/model/IConfigFile.ts) と同期させること
 */
export interface FeatureFlags {
    watchHistory?: boolean;
    notifications?: boolean;
    dashboard?: boolean;
    systemSettings?: boolean;
    seriesLibrary?: boolean;
    metadataProviders?: boolean;
    programSeriesMapping?: boolean;
    annictSync?: boolean;
    nextUpPanel?: boolean;
    externalFileImport?: boolean;
    advancedSearch?: boolean;
    updateNotification?: boolean;
}

/**
 * 放送波指定の番組表情報取得オプション
 */
export interface ScheduleOption {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isHalfWidth: boolean;
    needsRawExtended?: boolean;
    isFree?: boolean;
    GR: boolean;
    BS: boolean;
    CS: boolean;
    SKY: boolean;
    NW1: boolean;
    NW2: boolean;
    NW3: boolean;
    NW4: boolean;
    NW5: boolean;
    NW6: boolean;
    NW7: boolean;
    NW8: boolean;
    NW9: boolean;
    NW10: boolean;
    NW11: boolean;
    NW12: boolean;
    NW13: boolean;
    NW14: boolean;
    NW15: boolean;
    NW16: boolean;
    NW17: boolean;
    NW18: boolean;
    NW19: boolean;
    NW20: boolean;
    NW21: boolean;
    NW22: boolean;
    NW23: boolean;
    NW24: boolean;
    NW25: boolean;
    NW26: boolean;
    NW27: boolean;
    NW28: boolean;
    NW29: boolean;
    NW30: boolean;
    NW31: boolean;
    NW32: boolean;
    NW33: boolean;
    NW34: boolean;
    NW35: boolean;
    NW36: boolean;
    NW37: boolean;
    NW38: boolean;
    NW39: boolean;
    NW40: boolean;
}

/**
 * チャンネル指定の番組情報取得オプション
 */
export interface ChannelScheduleOption {
    startAt: UnixtimeMS;
    days: number; // 取得日数
    isHalfWidth: boolean;
    needsRawExtended?: boolean;
    isFree?: boolean;
    channelId: ChannelId;
}

export interface BroadcastingScheduleOption {
    time?: UnixtimeMS; // 追加時間 (ms)
    isHalfWidth: boolean;
}

/**
 * 番組表の放送局データ
 */
export interface ScheduleChannleItem {
    id: ChannelId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    remoteControlKeyId?: number;
    hasLogoData: boolean;
    channelType: ChannelType;
    type?: number;
}

/**
 * 番組表の番組データ
 */
export interface ScheduleProgramItem {
    id: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isFree: boolean;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
}

/**
 * 番組表データ
 */
export interface Schedule {
    channel: ScheduleChannleItem;
    programs: ScheduleProgramItem[];
}

/**
 * 番組検索オプション
 */
export interface ScheduleSearchOption {
    option: RuleSearchOption;
    isHalfWidth: boolean;
    limit?: number;
}

/**
 * Encode
 */

/**
 * エンコード情報
 */
export interface EncodeInfo {
    runningItems: EncodeProgramItem[]; // エンコード中
    waitItems: EncodeProgramItem[]; // エンコード待ち
}

export interface EncodeProgramItem {
    id: EncodeId;
    mode: string;
    recorded: RecordedItem;
    percent?: number;
    log?: string;
}

/**
 * エンコード追加オプション
 */
export interface AddEncodeProgramOption {
    recordedId: RecordedId;
    sourceVideoFileId: VideoFileId;
    parentDir: string; // 親ディレクトリ config recorded の name
    directory?: string; // 親ディレクトリ以下のディレクトリ設定
    mode: string; // config encode の name
    removeOriginal: boolean;
}

export interface AddManualEncodeProgramOption {
    recordedId: RecordedId;
    sourceVideoFileId: VideoFileId;
    parentDir?: string; // isSaveSameDirectory が false の場合は必須
    directory?: string;
    isSaveSameDirectory?: boolean; // ソースビデオファイルと同じ場所に保存する
    mode: string; // config encode の name
    removeOriginal: boolean;
}

/**
 * ライブストリームオプション
 */
export interface LiveStreamOption {
    channelId: ChannelId;
    mode?: number; // config 設定 (旧形式 index)。profile 未指定時は必須
    profile?: string; // config 設定 (新形式 StreamProfile.id)。指定時は mode より優先される
}

export interface RecordedStreanOption {
    videoFileId: VideoFileId;
    playPosition: number; // 再生位置 (秒)
    mode?: number; // config 設定 (旧形式 index)。profile 未指定時は必須
    profile?: string; // config 設定 (新形式 StreamProfile.id)。指定時は mode より優先される
}
/**
 * ライブストリーム情報
 */
export interface LiveStreamInfoItem {
    streamId: StreamId;
    type: StreamType;
    mode: number;
    isEnable: boolean;
    channelId: ChannelId;
    name: string;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
}

/**
 * ビデオファイルストリーム情報
 */
export interface VideoFileStreamInfoItem extends LiveStreamInfoItem {
    viodeFileId: VideoFileId;
    recordedId: RecordedId;
}

/**
 * アップロードするビデオ情報
 */
export interface UploadVideoFileOption {
    recordedId: RecordedId; // 紐付ける recorded id
    parentDirectoryName: string; // 保存先ディレクトリ名
    subDirectory?: string; // 保存先サブディレクトリ
    viewName: string; // UI 上での表示名
    fileType: VideoFileType; // ファイルタイプ
    file?: File; // ファイル
    localFilePath?: string; // アップロードファイルのローカルパス
}

/**
 * 新規追加する録画番組情報
 */
export interface CreateNewRecordedOption {
    ruleId?: RuleId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
}

/**
 * ストリーム情報
 */
export interface StreamInfo {
    items: (LiveStreamInfoItem | VideoFileStreamInfoItem)[];
}

/**
 * ディスク使用情報
 */
export interface DiskUsage {
    available: number;
    used: number;
    total: number;
}

/**
 * ディスク使用状況 + 名称
 */
export interface StorageItem extends DiskUsage {
    name: string;
}

/**
 * ディスク情報
 */
export interface StorageInfo {
    items: StorageItem[];
}

/**
 * 外部録画ファイル取り込みモード
 * register: 元ファイルを移動せず登録のみ行う / move: 録画ディレクトリへ移動する
 */
export type ImportMode = 'register' | 'move';

/**
 * 重複する録画が見つかった場合の挙動
 * skip: 取り込まない / add: 既存録画に video file を追加する / newRecorded: 別録画として新規登録する
 */
export type ImportDuplicateAction = 'skip' | 'add' | 'newRecorded';

/**
 * 外部録画ファイル取り込みのディレクトリスキャンオプション
 */
export interface ImportScanOption {
    importDirName: string; // config.importDirs で定義したディレクトリ名
    subPath?: string; // importDirName 配下のサブパス (省略時はルート)
    recursive?: boolean; // サブディレクトリも走査するか (既定 true)
}

/**
 * スキャンで見つかった取り込み候補ファイル 1 件分
 */
export interface ImportScanResultItem {
    filePath: string; // 実ファイルパス (importDirs 配下であることを検証済み)
    fileName: string;
    size?: number;
    estimatedName?: string;
    estimatedChannelName?: string;
    estimatedChannelId?: ChannelId;
    estimatedStartAt?: number;
    estimatedEndAt?: number;
    hasProgramTxt: boolean;
    hasErr: boolean;
    dropCount?: number;
    scramblingCount?: number;
    duplicateRecordedIds?: RecordedId[];
}

/**
 * 取り込みディレクトリスキャン結果
 */
export interface ImportScanResult {
    items: ImportScanResultItem[];
}

/**
 * 取り込み登録 1 件分のオプション
 */
export interface ImportRegisterItem {
    filePath: string; // スキャン結果で取得した実ファイルパス
    channelId: ChannelId;
    name: string;
    startAt: number;
    endAt?: number;
    parentDirectoryName: string;
    subDirectory?: string;
    fileType: VideoFileType;
    mode?: ImportMode;
    duplicateAction?: ImportDuplicateAction;
    duplicateRecordedId?: RecordedId;
    ruleId?: RuleId;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
}

/**
 * 外部録画ファイル取り込み登録オプション
 */
export interface ImportRegisterOption {
    items: ImportRegisterItem[];
}

/**
 * 取り込みジョブ開始結果
 */
export interface ImportJobStartResult {
    jobId: string;
}

/**
 * 取り込みジョブ内の 1 ファイル分の結果
 */
export interface ImportJobResultItem {
    localFilePath: string;
    imported: boolean;
    skipped?: boolean;
    recordedId?: RecordedId;
    name?: string;
    error?: string;
}

/**
 * 取り込みジョブの進捗状況
 */
export interface ImportJobStatus {
    jobId: string;
    total: number;
    done: number;
    successCount: number;
    failedCount: number;
    isRunning: boolean;
    results: ImportJobResultItem[];
}

/**
 * バージョン情報
 */
export interface VersionInfo {
    version: string;
}

/**
 * シリーズ id
 */
export type SeriesId = number;

/**
 * 放送種別
 */
export type SeriesAirType = 'first' | 'rerun' | 'delayed' | 'unknown';

export type SeriesSortKey = 'updatedAt' | 'title' | 'firstAiredAt' | 'lastAiredAt' | 'recordedCount' | 'totalFileSize';

export interface SeriesSeasonItem {
    seasonYear: number;
    seasonName: string;
    count: number;
}

/**
 * シリーズ一覧項目
 */
export interface SeriesListItem {
    id: SeriesId;
    title: string;
    normalizedTitle: string;
    mediaType: string;
    preferredChannelId: ChannelId | null;
    updatedAt: UnixtimeMS;
    // 読み仮名 (あいうえお順の並べ替えに使用)
    titleKana?: string | null;
    // 放送クール
    seasonYear?: number | null;
    seasonName?: 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN' | null;
    // クールの出所 (dictionary: 作品辞書 / estimated: 録画日時からの推測 / manual: 手動設定)
    seasonSource?: 'dictionary' | 'estimated' | 'manual' | null;
    // 録画件数・合計ファイルサイズ (バイト)
    recordedCount: number;
    totalFileSize: number;
    // 初回 / 最終録画日時
    firstAiredAt?: UnixtimeMS | null;
    lastAiredAt?: UnixtimeMS | null;
    // 未視聴の録画件数
    unwatchedCount: number;
    // 放送予定総話数 (不明なら null)
    totalEpisodes?: number | null;
    // 欠番の話数と、同一話数が複数録画されている件数
    missingEpisodeCount: number;
    duplicateEpisodeCount: number;
    // 直近の録画から放送中と推定されるか
    isOnAir: boolean;
    // アイキャッチ画像 (GET /api/series/{id}/image) が取得できるか
    hasImage: boolean;
    // 画像の出所 ('annict': 作品辞書の画像 / 'thumbnail': 録画から生成したサムネイル)
    imageSource?: 'annict' | 'thumbnail' | null;
    // 画像の著作権表記 (imageSource が 'annict' のときのみ入る)
    imageCopyright?: string | null;
    // シリーズの出所 ('dictionary': 外部の作品辞書由来 / 'local': 録画タイトルから作られた)
    origin: SeriesOrigin;
}

/**
 * シリーズの出所 ('dictionary': しょぼいカレンダー / Annict / Wikidata の ID を持つ / 'local': 録画タイトルから作られた)
 */
export type SeriesOrigin = 'dictionary' | 'local';

/**
 * マージ候補の一致種別
 * 'exact': 正規化タイトルが完全一致 / 'prefix': 候補が対象タイトルで始まる /
 * 'contained': 対象が候補タイトルで始まる / 'partial': 先頭の一部だけ一致
 */
export type SeriesMergeMatchType = 'exact' | 'prefix' | 'contained' | 'partial';

/**
 * マージ候補
 */
export interface SeriesMergeCandidate {
    seriesId: SeriesId;
    title: string;
    normalizedTitle: string;
    origin: SeriesOrigin;
    recordedCount: number;
    seasonYear?: number | null;
    seasonName?: 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN' | null;
    matchType: SeriesMergeMatchType;
    // 正規化タイトルの共通接頭辞の文字数
    commonPrefixLength: number;
}

/**
 * マージ候補一覧
 */
export interface SeriesMergeCandidateResult {
    // マージ元 (統合される側) のシリーズ
    seriesId: SeriesId;
    title: string;
    normalizedTitle: string;
    origin: SeriesOrigin;
    candidates: SeriesMergeCandidate[];
}

/**
 * シリーズ一覧
 */
export interface SeriesListResult {
    items: SeriesListItem[];
    total: number;
}

/**
 * シリーズに紐づく録画
 */
export interface SeriesRecordedRow {
    recordedId: RecordedId;
    channelId: ChannelId;
    channelName: string | null;
    recordedTitle: string;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    episodeId: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    episodeLabel: string | null;
    episodeTitle: string | null;
    airType: string;
    confidence: number;
}

/**
 * シリーズ詳細
 */
export interface SeriesDetail extends SeriesListItem {
    externalIds: { syobocalTid: number | null; annictId: string | null; tmdbId: number | null };
    channels: Array<{ channelId: ChannelId; channelName: string | null; count: number }>;
    continuity: {
        missingEpisodes: Array<{ seasonNumber: number; episodeNumber: number }>;
        duplicateEpisodes: Array<{
            seasonNumber: number;
            episodeNumber: number;
            recordedIds: number[];
            channelIds: number[];
        }>;
        unknownEpisodeRecordedIds: number[];
    };
    recorded: SeriesRecordedRow[];
}

/**
 * 録画のシリーズ割当情報
 */
export interface SeriesMappingValue {
    recordedId: RecordedId;
    recordedTitle: string;
    seriesId: SeriesId;
    seriesTitle: string;
    episodeId: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    airType: string;
    matchMethod: string;
    confidence: number;
    manualLock: boolean;
}

/**
 * シリーズ手動割当のリクエストボディ
 */
export interface UpdateSeriesMappingOption {
    seriesId?: number;
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number | null;
    airType?: SeriesAirType;
    learnAlias?: boolean;
}

/**
 * シリーズ割当の一括更新 1 件分。
 * 省略した項目は現在の値を維持する (話数だけ・放送種別だけの更新ができる)
 */
export interface BulkSeriesMappingItem {
    recordedId: RecordedId;
    seasonNumber?: number;
    episodeNumber?: number | null;
    airType?: SeriesAirType;
}

/**
 * シリーズ割当の一括更新リクエストボディ
 */
export interface BulkUpdateSeriesMappingOption {
    items: BulkSeriesMappingItem[];
    // 正規化タイトル → シリーズの対応を辞書に学習させるか (既定 false)
    learnAlias?: boolean;
}

/**
 * シリーズ割当の一括更新結果
 */
export interface BulkUpdateSeriesMappingResult {
    updated: number;
    failed: Array<{ recordedId: RecordedId; message: string }>;
}

/**
 * 未確定候補
 */
export interface SeriesPendingMatchCandidate {
    seriesId: SeriesId;
    seriesTitle: string;
    score: number;
}

/**
 * 未確定キューの1件
 */
export interface SeriesPendingMatchItem {
    id: number;
    recordedId: RecordedId;
    recordedTitle: string;
    normalizedTitle: string;
    channelId: ChannelId;
    candidates: SeriesPendingMatchCandidate[];
    createdAt: UnixtimeMS;
}

/**
 * 未確定キュー一覧
 */
export interface SeriesPendingListResult {
    items: SeriesPendingMatchItem[];
    total: number;
}

/**
 * シリーズマージのリクエストボディ
 */
export interface MergeSeriesOption {
    // 統合元。単体指定 (fromSeriesId) と複数指定 (fromSeriesIds) のどちらでもよい
    fromSeriesId?: SeriesId;
    fromSeriesIds?: SeriesId[];
    toSeriesId: SeriesId;
}

/**
 * シリーズマージ結果
 */
export interface MergeSeriesResult {
    movedLinkCount: number;
    // 統合して削除したシリーズ数
    mergedSeriesCount: number;
}

/**
 * シリーズ分割のリクエストボディ
 */
export interface SplitSeriesOption {
    recordedIds: RecordedId[];
    newTitle: string;
}

/**
 * シリーズ分割結果
 */
export interface SplitSeriesResult {
    seriesId: SeriesId;
    title: string;
}

/**
 * シリーズエイリアス辞書の1件
 */
export interface SeriesAliasItem {
    id: number;
    normalizedTitle: string;
    seriesId: SeriesId;
    seriesTitle: string;
    // 学習元 ('manual': 手動修正 / 'llm': LLM 抽出を検証して自動学習)
    source: string;
    createdAt: UnixtimeMS;
}

/**
 * エイリアス辞書の付け替えリクエストボディ。
 * seriesId を優先し、無ければ seriesTitle でシリーズを検索/作成する。
 * 付け替えた辞書は手動修正扱い (source: 'manual') になる
 */
export interface UpdateSeriesAliasOption {
    seriesId?: SeriesId;
    seriesTitle?: string;
}

/**
 * エイリアス辞書の一括編集 1 件分
 */
export interface BulkSeriesAliasItem extends UpdateSeriesAliasOption {
    aliasId: number;
    // true の場合は付け替えではなく辞書から削除する
    remove?: boolean;
}

/**
 * エイリアス辞書の一括編集リクエストボディ
 */
export interface BulkUpdateSeriesAliasOption {
    items: BulkSeriesAliasItem[];
}

/**
 * エイリアス辞書の一括編集結果
 */
export interface BulkUpdateSeriesAliasResult {
    updated: number;
    removed: number;
    failed: Array<{ aliasId: number; message: string }>;
}

/**
 * 既存録画のシリーズ化バックフィル開始オプション
 */
export interface SeriesBackfillOption {
    // true の場合 DB を変更せずマッチ結果のプレビューのみ行う
    dryRun?: boolean;
    // 1 回に処理する録画件数 (省略時はデフォルト値)
    chunkSize?: number;
}

/**
 * バックフィルの実行状態
 */
export type SeriesBackfillState = 'idle' | 'running' | 'completed' | 'canceled' | 'failed';

/**
 * ドライラン時の候補シリーズ
 */
export interface SeriesBackfillPreviewCandidate {
    // null はこのドライラン実行中に新規作成される予定のシリーズ (まだ DB に存在しない)
    seriesId: SeriesId | null;
    seriesTitle: string;
    score: number;
}

/**
 * ドライラン時の 1 録画分のプレビュー結果
 */
export interface SeriesBackfillPreviewItem {
    recordedId: RecordedId;
    title: string;
    matched: boolean;
    seriesId: SeriesId | null;
    seriesTitle: string | null;
    confidence: number | null;
    candidates: SeriesBackfillPreviewCandidate[];
}

/**
 * バックフィルの進捗状況
 */
export interface SeriesBackfillResult {
    state: SeriesBackfillState;
    dryRun: boolean;
    total: number;
    processed: number;
    linked: number;
    pending: number;
    skipped: number;
    failed: number;
    startedAt: UnixtimeMS | null;
    finishedAt: UnixtimeMS | null;
    lastRecordedId: RecordedId;
    error: string | null;
    previewItems?: SeriesBackfillPreviewItem[];
    previewTruncated?: boolean;
}

export interface MetadataProviderInfo {
    name: string;
}

export interface MetadataProviders {
    providers: MetadataProviderInfo[];
}

export interface MetadataSearchResult {
    provider: string;
    externalId: string;
    title: string;
    originalTitle?: string;
    year?: number;
    score: number;
    imageUrl?: string;
    syobocalTid?: number;
}

export interface MetadataSearchResults {
    results: MetadataSearchResult[];
}

export interface ProgramSeriesMetrics {
    unmatchedRate: number;
    confidenceHistogram: number[];
    totalPrograms: number;
    matchedPrograms: number;
    updatedAt: UnixtimeMS | null;
}
export interface AnnictWatchSyncResult {
    queued: number;
}
export interface MissingEpisodeProposalCandidate {
    programId: ProgramId;
    channelId: ChannelId;
    name: string;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
}
export interface MissingEpisodeProposal {
    seasonNumber: number;
    episodeNumber: number;
    candidates: MissingEpisodeProposalCandidate[];
}
export interface MissingEpisodeProposals {
    proposals: MissingEpisodeProposal[];
}

// システム設定 (トップレベルキーごとの値。詳細な形は src/model/api/config/AppSettingSchema.ts が正)
export type AppSettingValue = Record<string, any>;

export interface AppSettingUpdateResult {
    settings: AppSettingValue;
    requiresRestart: boolean;
    requiresRestartKeys: string[];
}

export interface AppSettingHistoryItem {
    id: number;
    key: string;
    updatedAt: UnixtimeMS;
}

export interface NotificationTestResult {
    delivered: string[];
    failed: string[];
}

export interface AnnictConnectionTestResult {
    ok: boolean;
    username?: string;
    message?: string;
}

export interface SyobocalChannelMapEntry {
    chId: number;
    networkId: NetworkId;
    serviceId: ServiceId;
    syobocal?: boolean;
}

export interface SharedDataSyncResult {
    updated: boolean;
}

export interface SyobocalTitleDictionaryStatus {
    titleCount: number;
    lastUpdate: string | null;
    lastSyncedAt: number | null;
    running: boolean;
    error: string | null;
}

export interface SyobocalTitleSyncResult extends SyobocalTitleDictionaryStatus {
    imported: number;
    full: boolean;
}

export interface AnnictWorkDictionaryStatus {
    workCount: number;
    linkedToSyobocalCount: number;
    lastSyncedAt: number | null;
    running: boolean;
    error: string | null;
}

export interface AnnictWorkSyncResult extends AnnictWorkDictionaryStatus {
    imported: number;
}

export interface NotificationFailureHistoryItem {
    id: number;
    targetName: string;
    eventType: string;
    attempts: number;
    lastError: string | null;
    updatedAt: UnixtimeMS;
}

/**
 * 公開されているリリース 1 件分
 */
export interface UpdateReleaseInfo {
    // リリースタグ (例: 2.14.0-stuayu-260727)
    tag: string;
    name: string;
    // GitHub の prerelease フラグ (rc / beta / alpha 等)
    prerelease: boolean;
    publishedAt: UnixtimeMS | null;
    htmlUrl: string;
    // リリースノート (先頭のみ。UI で折りたたんで表示する)
    body: string;
}

/**
 * 更新チャンネル ('stable': 正式リリース / 'prerelease': プレリリース・ベータ)
 */
export type UpdateChannel = 'stable' | 'prerelease';

/**
 * EPGStation の導入形態 ('git': リポジトリを clone したもの / 'archive': 配布アーカイブ)
 */
export type UpdateInstallationType = 'git' | 'archive';

/**
 * EPGStation を監視・自動再起動している仕組み
 */
export type UpdateSupervisorType = 'docker' | 'systemd' | 'pm2' | 'windows-service' | 'none';

/**
 * 更新ジョブの状態
 */
export type UpdateJobStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'restarting';

/**
 * 更新ジョブの 1 行分のログ
 */
export interface UpdateJobLogLine {
    at: UnixtimeMS;
    // 'info' | 'command' | 'error'
    level: 'info' | 'command' | 'error';
    message: string;
}

/**
 * 更新ジョブ
 */
export interface UpdateJob {
    status: UpdateJobStatus;
    // 更新先のタグ (実行中・完了時のみ)
    tag: string | null;
    // 実行中のステップ名 (例: 'git fetch')
    step: string | null;
    startedAt: UnixtimeMS | null;
    finishedAt: UnixtimeMS | null;
    error: string | null;
    logs: UpdateJobLogLine[];
}

/**
 * 追従先ブランチ (main 等) の最新コミット
 */
export interface UpdateBranchInfo {
    // ブランチ名
    name: string;
    sha: string;
    shortSha: string;
    // コミットメッセージの 1 行目
    message: string;
    committedAt: UnixtimeMS | null;
    htmlUrl: string;
    // ローカルの HEAD がこのコミットと同じか
    upToDate: boolean;
}

/**
 * 更新状況
 */
export interface UpdateStatus {
    // 現在のバージョン (git 管理下ならチェックアウト中のタグ、無ければ package.json の version)
    currentVersion: string;
    // 現在のバージョンがプレリリースか
    currentIsPrerelease: boolean;
    // 最新の正式リリース / プレリリース (取得できなければ null)
    latestStable: UpdateReleaseInfo | null;
    latestPrerelease: UpdateReleaseInfo | null;
    // 通知対象となる更新 (設定で決まるチャンネルを考慮した結果。無ければ null)
    availableRelease: UpdateReleaseInfo | null;
    // availableRelease のチャンネル
    availableChannel: UpdateChannel | null;
    // 最後にリリース情報を取得できた時刻
    checkedAt: UnixtimeMS | null;
    // リリース情報の取得に失敗した場合の理由
    checkError: string | null;
    // 追従先ブランチの最新コミット (取得できなければ null)
    branch: UpdateBranchInfo | null;
    // ローカルの HEAD コミット (git 管理下のときのみ)
    currentCommit: string | null;
    // 導入形態と再起動方法
    installationType: UpdateInstallationType;
    supervisor: UpdateSupervisorType;
    // ワンクリック更新を実行できるか
    canUpdate: boolean;
    // canUpdate が false のときの理由 / true のときの再起動方法の説明
    updateNote: string;
    // リリース一覧ページ
    releasesUrl: string;
    job: UpdateJob;
}

/**
 * 更新実行のリクエストボディ
 */
export interface RunUpdateOption {
    // 更新先のタグ。省略時は availableRelease のタグ
    tag?: string;
    // 更新先の指定方法。'branch' の場合はブランチの最新コミットへ追従する (既定 'tag')
    refType?: 'tag' | 'branch';
    // refType が 'branch' のときの対象ブランチ。省略時は設定のブランチ (既定 main)
    ref?: string;
    // 更新完了後に再起動するか (既定 true)
    restart?: boolean;
}

/**
 * ログインユーザー
 */
export interface AuthUserItem {
    id: number;
    name: string;
    // 'admin': システム管理者 (設定変更・ユーザー管理が可能) / 'user': 一般
    role: AuthRole;
    // パスワードでログインできるか (SSO のみのユーザーは false)
    hasPassword: boolean;
    // 紐付いている外部 ID プロバイダ ('google' / 'github')
    providers: string[];
    createdAt: UnixtimeMS;
}

/**
 * ログインユーザーの権限
 */
export type AuthRole = 'admin' | 'user';

/**
 * 利用できる外部 ID プロバイダ (認証状態と一緒に返す。秘密情報は含まない)
 */
export interface AuthProviderItem {
    id: string;
    label: string;
    // 認可エンドポイントへ飛ばす URL
    authorizeUrl: string;
}

/**
 * 認証状態
 */
export interface AuthStatus {
    // config.yml の auth.enabled
    enabled: boolean;
    // 初期ユーザーが作成済みか (false の場合は初期セットアップが必要)
    initialized: boolean;
    // ログイン中のユーザー (未ログインなら null)
    user: { id: number; name: string; role: AuthRole } | null;
    // 設定済みの外部 ID プロバイダ (ログイン画面のボタン用)
    providers: AuthProviderItem[];
    // 2 人目以降のサインアップを許可しているか
    allowSignUp: boolean;
}

/**
 * ログイン / 初期セットアップのリクエストボディ
 */
export interface AuthCredentialOption {
    name: string;
    password: string;
}

/**
 * パスワード変更のリクエストボディ
 */
export interface UpdateUserRoleOption {
    role: AuthRole;
}

/**
 * パスワード変更のリクエストボディ
 */
export interface ChangePasswordOption {
    newPassword: string;
    // 自分のパスワードを変更する場合に必要
    currentPassword?: string;
}
