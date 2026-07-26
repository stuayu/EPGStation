import * as apid from '../../api';
import * as Enums from '../Enums';

export interface HttpsConfig {
    port: number;
    key: string; // 秘密鍵
    cert: string; // 証明書
    ca?: string | string[]; // クライアント認証用秘密鍵
    socketioPort?: number;
}

export interface RecordedDirInfo {
    name: string;
    path: string;
    limitThreshold?: number; // 空き容量限界閾値 (MB)
    action?: 'remove' | 'none'; // 空き容量限界値を超えたときの動作
    limitCmd?: string; // 空き容量限界値を超えたときに実行するコマンド
}

/**
 * 外部録画ファイル取り込み (EDCB 等) を許可するディレクトリ
 * 未設定 (空配列) の場合は取り込み機能自体が無効となる
 */
export interface ImportDirInfo {
    name: string;
    path: string;
}

export interface URLSchemeInfo {
    ios?: string;
    android?: string;
    mac?: string;
    win?: string;
}

export interface StreamingCmd {
    name: string;
    cmd?: string;
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
 * id ベースの配信プリセット (新形式)
 * cmd を省略した場合 container / video / audio から ffmpeg コマンドを自動生成する。
 * video / audio も省略した場合は無変換 (isUnconverted) 扱いとなる。
 */
export interface StreamProfile {
    id: string;
    name: string;
    container: StreamContainer;
    video?: StreamVideoParam;
    audio?: StreamAudioParam;
    cmd?: string;
    isUnconverted?: boolean;
}

export const FEATURE_FLAG_KEYS = [
    'watchHistory',
    'notifications',
    'dashboard',
    'systemSettings',
    'seriesLibrary',
    'metadataProviders',
    'programSeriesMapping',
    'annictSync',
    'nextUpPanel',
    'externalFileImport',
    'advancedSearch',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlags = Partial<Record<FeatureFlagKey, boolean>>;

export type NotificationEventType = 'recording.started' | 'recording.completed' | 'recording.failed';
export interface NotificationTargetConfig {
    name: string;
    type: 'webhook' | 'discord';
    url: string;
    secret?: string;
    events?: NotificationEventType[];
}
export interface NotificationConfig {
    targets: NotificationTargetConfig[];
    maxAttempts?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
}

export interface KodiInfo {
    name: string;
    host: string;
    user?: string;
    password?: string;
}

/**
 * config ファイル形式
 */
export default interface IConfigFile {
    port?: number;
    socketioPort?: number;
    clientSocketioPort?: number;
    https?: HttpsConfig;
    // 段階導入用。未指定の機能は常に無効として扱う
    featureFlags?: FeatureFlags;
    secretKey?: string; // ランタイム設定の秘密情報暗号化鍵（環境変数展開済みの十分長い値を推奨）

    mirakurunPath: string;
    mirakurunAPIPath?: string; // mirakurun の API エンドポイントのベースパス (省略時 /api)

    subDirectory?: string;

    uid?: number | string; // uid
    gid?: number | string; // gid

    apiServers: string[];

    isAllowAllCORS: boolean;

    dbtype: Enums.DBType;
    sqlite?: {
        extensions?: string[];
        regexp?: boolean;
    };
    mysql?: {
        host: string;
        user: string;
        port: number;
        password: string;
        database: string;
        charset?: string;
    };
    postgres?: {
        host: string;
        user: string;
        port: number;
        database: string;
        password: string;
    };

    // 囲み文字を置換するか
    needToReplaceEnclosingCharacters: boolean;

    // epg 更新時間間隔 (分)
    epgUpdateIntervalTime: number;

    // 放送局並び順
    channelOrder?: apid.ChannelId[];
    sidOrder?: apid.ServiceId[];

    // 放送局除外設定
    excludeChannels?: apid.ChannelId[];
    excludeSids?: apid.ServiceId[];

    // priority 設定
    recPriority: number;
    conflictPriority: number;
    streamingPriority: number;

    // 時刻指定予約マージン
    timeSpecifiedStartMargin: number;
    timeSpecifiedEndMargin: number;

    // 録画ファイル名フォーマット
    recordedFormat: string;

    // 拡張子
    recordedFileExtension: string;

    // 録画ディレクトリ
    recorded: RecordedDirInfo[];
    // 録画一時ディレクトリ
    recordedTmp?: string;

    // 外部録画ファイル (EDCB 等) の取り込みを許可するディレクトリ。未設定 (既定 []) の場合は取り込み機能が無効
    importDirs?: ImportDirInfo[];
    // 取り込み時の既定モード。register: 元ファイルを移動せずそのまま登録する / move: 録画ディレクトリへ移動する
    importDefaultMode?: 'register' | 'move';
    // EDCB ファイル名推定用のカスタム正規表現 (named capture group: year, month, day, hour, min, sec, name, channel)
    importFileNamePatterns?: string[];
    // 取り込みディレクトリの自動監視を有効にするか (既定 false)
    importWatch?: boolean;
    // 自動監視の実行間隔 (秒)
    importWatchIntervalSec?: number;

    // 録画履歴保存期間
    recordedHistoryRetentionPeriodDays: number;

    // ストレージ空き容量チェック間隔 (秒)
    storageLimitCheckIntervalTime: number;

    // サムネイル
    thumbnail: string;
    thumbnailCmd: string;
    thumbnailSize: string;
    thumbnailPosition: number;

    // drop log
    dropLog: string;
    isEnabledDropCheck: boolean; // drop check を有効にするか

    // upload
    uploadTempDir: string;

    ffmpeg: string;
    ffprobe: string;
    tsreadex?: string; // tsreadex の実行ファイルパス (省略時は PATH 上の tsreadex を使用)

    // エンコード設定
    encodeProcessNum: number; // 録画ファイルエンコード最大プロセス数
    streamProcessNum: number; // 視聴用ストリーミング最大プロセス数
    concurrentEncodeNum: number; // 同時エンコード数
    encode: {
        id?: string; // プリセット識別子。省略時は name を識別子とみなす (完全後方互換)
        name: string;
        cmd: string;
        suffix?: string; // 非エンコードコマンドの場合 undefined
        rate?: number;
        video?: StreamVideoParam; // クライアント表示用の映像設定情報 (配信側の型を再利用)
        audio?: StreamAudioParam; // クライアント表示用の音声設定情報 (配信側の型を再利用)
    }[];

    // 予約定期更新時のログ出力を抑えるか
    isSuppressReservesUpdateAllLog: boolean;

    // Webhook / Discord 通知（featureFlags.notifications が true の場合のみ有効）
    notifications?: NotificationConfig;

    // 各種フックコマンド
    reserveNewAddtionCommand?: string; // 予約新規追加
    reserveUpdateCommand?: string; // 予約情報更新
    reservedeletedCommand?: string; // 予約削除
    recordingPreStartCommand?: string; // 録画準備開始
    recordingPrepRecFailedCommand?: string; // 録画準備失敗
    recordingStartCommand?: string; // 録画開始
    recordingFinishCommand?: string; // 録画終了
    recordingFailedCommand?: string; // 録画中のエラー
    encodingFinishCommand?: string; // エンコード終了

    // 視聴 URL Scheme 設定
    urlscheme: {
        m2ts: URLSchemeInfo;
        video: URLSchemeInfo;
        download: URLSchemeInfo;
    };

    streamFilePath: string;
    stream?: {
        live?: {
            ts?: {
                m2ts?: StreamingCmd[];
                m2tsll?: StreamingCmd[];
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
        };
        recorded?: {
            ts?: {
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
            encoded?: {
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
        };
        // id ベースの配信プリセット設定 (新形式)。指定された場合、対象スコープでは live/recorded 旧形式より優先される
        profiles?: {
            live?: StreamProfile[];
            recorded?: {
                ts?: StreamProfile[];
                encoded?: StreamProfile[];
            };
        };
    };

    // 配信先 kodi 設定
    kodiHosts?: KodiInfo[];
}
