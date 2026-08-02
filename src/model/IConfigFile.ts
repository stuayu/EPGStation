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

/**
 * エンコードプリセット表 (§ encodePresets) の軸定義
 *
 * ハードウェア (software / qsv (Intel) / vaapi (AMD) / nvenc (NVIDIA)) ×
 * コーデック (h264 / hevc) × 画質 (1080p / 720p / 480p / 240p) × 用途の
 * 組み合わせから、録画エンコード (encode) / ライブ HLS・録画ストリーミング
 * (stream.profiles) の設定を自動生成するための一括有効化フラグ。
 *
 * 注意: `api.d.ts` の `Config.encodePresets` (`ClientEncodePreset[]`) とは別物。
 * そちらは `ConfigApiModel` が `config.encode` から作るクライアント表示用の
 * 解決済みプリセット一覧 (配列) で、こちらは config.yml 側の入力フラグ (オブジェクト)
 */
export type EncodeHwAccel = 'software' | 'qsv' | 'vaapi' | 'nvenc' | 'qsvencc' | 'nvencc' | 'vceencc';
export type EncodeCodec = 'h264' | 'hevc';
export type EncodeQuality = '1080p' | '720p' | '480p' | '240p';

/**
 * プリセットの適用先。
 * - recorded: 録画ファイルのバックグラウンドエンコード (config.encode 相当、config/enc.js 経由)
 * - liveHLS: ライブ視聴の HLS 配信 (stream.profiles.live、container: hls、in-memory 低遅延配信)
 * - recordedStreaming: 録画再生の mp4 / HLS 配信 (stream.profiles.recorded.ts / encoded)
 *   (webm は vp9 系のためこのプリセット表の対象外。従来通り手書きで管理する)
 */
export type EncodePresetTarget = 'recorded' | 'liveHLS' | 'recordedStreaming';

export interface EncodePresetsConfig {
    // 使用するハードウェアアクセラレーション。省略時 software
    // qsvencc / nvencc / vceencc は rigaya 氏の QSVEncC / NVEncC / VCEEncC を ffmpeg と
    // パイプ連結して使う方式 (実行ファイルパスは config.yml の qsvencc / nvencc / vceencc で指定)
    hwaccel?: EncodeHwAccel;
    // 有効化するコーデック。省略時 [h264]
    codecs?: EncodeCodec[];
    // 有効化する画質。省略時 [1080p, 720p, 480p]
    qualities?: EncodeQuality[];
    // 生成対象。省略時 [recorded, liveHLS, recordedStreaming]
    targets?: EncodePresetTarget[];
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
    'updateNotification',
    'dataBroadcasting',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlags = Partial<Record<FeatureFlagKey, boolean>>;

export type NotificationEventType =
    | 'recording.started'
    | 'recording.completed'
    | 'recording.failed'
    | 'recording.dropped' // ドロップ検出 (§7.3)
    | 'recording.missed' // 録り逃し検出 (リトライ上限に達し録画を断念)
    | 'series.newEpisode' // シリーズ新話追加
    | 'storage.lowSpace'; // ディスク残量低下
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
    // true の場合 SSRF ガードを無効にし、ローカル/プライベートアドレス宛の通知を許可する
    // (社内ネットワークの Webhook 受け口を使う場合のみ明示的に有効化すること)
    allowPrivateNetworkTargets?: boolean;
}

/**
 * 外部 ID プロバイダ (Google / GitHub) の OAuth 設定
 */
export interface OAuthProviderConfig {
    clientId?: string;
    clientSecret?: string;
    // コールバック URL。省略時は「アクセス元の URL + /api/auth/oauth/<provider>/callback」
    redirectUri?: string;
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
    // 機能フラグ。**未指定の機能は有効**として扱うため、止めたいものだけ false を書く
    featureFlags?: FeatureFlags;

    // しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId のマッピング表 (JSON) のパス。
    // 省略時は同梱の初期データ (主要地上波キー局のみ) を使う。指定したファイルは同梱データを上書き/追加する
    metadataChannelMappingPath?: string;

    // 共有静的データ (チャンネルマッピング表・エイリアス辞書) を GitHub 等から自動取得する URL (§5.1)。
    // 起動時 + metadataSharedDataUpdateIntervalMs 間隔で取得し、ローカルにキャッシュする。
    // オフライン/取得失敗時は前回キャッシュ → 同梱データの順にフォールバックする
    metadataSharedDataUrl?: string;
    // 自動更新間隔 (ms)。省略時 24 時間。0 を指定すると起動時取得のみで定期更新を行わない
    metadataSharedDataUpdateIntervalMs?: number;

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

    // 過去の番組表データの保存期間 (時間)。
    // 0 なら終了した番組を即座に削除する (従来動作)、-1 なら削除しない (無期限)
    epgRetentionTime: number;

    // 過去の番組表データを削除する間隔 (分)。省略時は epgUpdateIntervalTime と同じ
    epgDeleteIntervalTime?: number;

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

    // 録画開始のリトライ方針。
    // 前番組の延長 (放送時刻未定) で開始が遅れている場合と、チューナー異常とを分けて扱う
    recording?: {
        // 番組開始を待つ上限 (ms)。既定 3 時間。0 で待たない
        startWaitLimitMs?: number;
        // 開始待ち中の再試行間隔 (ms)。既定 60000
        startWaitIntervalMs?: number;
        // ストリーム開始後、最初のデータを待つ時間 (ms)。既定 5000。
        // これを超えたら「まだ番組が始まっていない」と判断する
        firstDataTimeoutMs?: number;
        // チューナー異常時に短い間隔で再試行する回数と間隔 (既定 3 回 / 5000ms)
        errorFastRetryCount?: number;
        errorFastRetryIntervalMs?: number;
        // その後、長い間隔で再試行する回数と間隔 (既定 27 回 / 60000ms)
        errorRetryCount?: number;
        errorRetryIntervalMs?: number;
        // 予約した番組が EIT[p/f] present になるまで録画を始めない (既定 true)。
        // false にすると従来どおりストリームの最初のデータで録画を開始する
        startGateEnabled?: boolean;
        // EIT[p/f] を読めないまま録画を開始するまでの時間 (ms)。既定 60000
        startGateTimeoutMs?: number;
        // 放送中の番組の開始時刻が予約開始時刻よりこれ以上前なら「前の番組」とみなす (ms)。既定 120000
        startGateStartMarginMs?: number;
    };

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
    // rigaya 氏のハードウェアエンコーダの実行ファイルパス (省略時は PATH 上のコマンド名 (QSVEncC/NVEncC/VCEEncC) を使用)
    // encodePresets.hwaccel や encode[].cmd / stream.profiles の cmd 内で明示的に呼び出す場合に使用する
    qsvencc?: string;
    nvencc?: string;
    vceencc?: string;

    // エンコード設定
    encodeProcessNum: number; // 録画ファイルエンコード最大プロセス数
    streamProcessNum: number; // 視聴用ストリーミング最大プロセス数
    concurrentEncodeNum: number; // 同時エンコード数

    // 組み込みエンコードプリセット表の一括有効化フラグ。
    // 指定した軸の組み合わせから encode / stream.profiles を自動生成する (詳細は EncodePresetsConfig を参照)。
    // 対象セクション (encode / stream.profiles.live / stream.profiles.recorded.{ts,encoded}) に
    // 手書きの設定が既にある場合はそちらを優先し、自動生成では上書きしない
    encodePresets?: EncodePresetsConfig;

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

    // Web UI / API のログイン認証。既定は無効 (リバースプロキシ側で認証している構成を壊さないため)。
    // 有効にすると初回アクセス時に管理ユーザーの作成を求められる
    auth?: {
        // false でログイン不要にする。**未指定は有効** (opt-out)
        enabled?: boolean;
        // 外部プレイヤー・IPTV 用アクセストークンの有効期間 (ms)。既定 365 日
        mediaTokenTtlMs?: number;
        // セッションの有効期間 (ms)。既定 30 日
        sessionTtlMs?: number;
        // ログインしていない利用者にも一般ユーザーと同じ操作を許可するか。**未指定は許可** (opt-out)。
        // 視聴・予約・録画閲覧などはログイン不要で行える一方、
        // 設定変更・ユーザー管理・バージョン更新はシステム管理者としてのログインが必要なままになる。
        // インターネットに公開している場合は false にすること
        allowAnonymous?: boolean;
        // 2 人目以降のサインアップ (SSO での新規ユーザー作成) を許可するか。既定 true。
        // 最初にサインアップしたユーザーは自動でシステム管理者になり、以降は一般権限になる
        allowSignUp?: boolean;
        // 外部 ID プロバイダ (SSO)。ログイン前に必要なため DB ではなくこちらに書く
        providers?: {
            google?: OAuthProviderConfig;
            github?: OAuthProviderConfig;
        };
    };

    // Webhook / Discord 通知（featureFlags.notifications が true の場合のみ有効）
    notifications?: NotificationConfig;

    // 新しいバージョンの公開チェック (featureFlags.updateNotification が true の場合のみ有効)
    updateChecker?: {
        // 監視するリポジトリ ('owner/repo' 形式)。省略時 stuayu/EPGStation
        repository?: string;
        // 追従先ブランチ。設定画面から「最新の開発版へ更新」する際の対象。省略時 main
        branch?: string;
        // チェック間隔 (ms)。省略時 6 時間、0 以下でチェックを停止する
        checkIntervalMs?: number;
        // プレリリース (rc / beta / alpha) も通知対象に含めるか。省略時 true (UI では色を変えて区別する)
        includePrerelease?: boolean;
    };

    // メタデータプロバイダーの既定値 (§6.3)。設定画面 (DB) で値が設定されていない場合のみ使用される。
    // token 等の秘密情報はここに書かず設定画面から入力すること
    metadataDefaults?: {
        annict?: {
            enabled?: boolean;
            // 作品辞書の自動同期間隔 (ms)。省略時 7 日、0 以下で自動同期を停止する
            workSyncIntervalMs?: number;
        };
        wikidata?: {
            // 全ジャンルのテレビ番組辞書 (Wikidata) の取り込みを有効にするか (既定 true)
            enabled?: boolean;
            // 辞書の自動同期間隔 (ms)。省略時 7 日、0 以下で自動同期を停止する
            syncIntervalMs?: number;
        };
        syobocal?: {
            enabled?: boolean;
            // アニメ作品タイトル辞書の自動同期間隔 (ms)。省略時 24 時間、0 以下で自動同期を停止する
            titleSyncIntervalMs?: number;
        };
        cacheTtlMs?: number;
        // 外部サービスのエンドポイント URL。Cloudflare 等のキャッシュ/プロキシを手前に置く場合に差し替える。
        // 設定画面 (DB) の値が優先される。プロキシは元サービスと同じインターフェースを保つこと
        endpoints?: {
            // しょぼいカレンダー DB API (既定 https://cal.syoboi.jp/db.php)
            syobocal?: string;
            // Annict GraphQL API (既定 https://api.annict.com/graphql)
            annict?: string;
            // Wikidata SPARQL エンドポイント (既定 https://query.wikidata.org/sparql)
            wikidata?: string;
            // Twitter アバター解決用 fxtwitter JSON API (既定 https://api.fxtwitter.com/)
            fxtwitter?: string;
            // 共有静的データ URL (既定なし。metadataSharedDataUrl と同義、こちらが優先)
            sharedData?: string;
        };
    };

    // シリーズ自動マッピングの既定値 (§6.3)。設定画面 (DB) の値が優先される
    seriesDefaults?: {
        matchThreshold?: number;
    };

    // シリーズ自動マッピングのローカル LLM フォールバック。url と model の両方を指定した場合のみ有効。
    // 作品辞書 (しょぼいカレンダー + Annict) で確定できなかった録画タイトルに対してのみ呼び出され、
    // 抽出された作品名で辞書を引き直す (抽出結果単体でリンクを確定させることはない)
    seriesLlm?: {
        // OpenAI 互換 Chat Completions API のベース URL (例: Ollama は http://localhost:11434/v1)
        url?: string;
        // モデル名 (例: qwen2.5:7b-instruct)
        model?: string;
        // API キー (ローカル LLM では通常不要。OpenRouter 等のホスティング API では必須)
        apiKey?: string;
        // リクエストタイムアウト (ms)。既定 30000
        timeoutMs?: number;
        // リクエスト間隔の下限 (ms)。既定 0 (無制限)。
        // OpenRouter のフリーモデルのような分あたり上限がある API では 3500 程度を指定する
        minIntervalMs?: number;
        // 応答の上限トークン数。既定 2000。
        // 思考過程にトークンを使う reasoning 系モデルは小さいと本文が空のまま切れる。
        // 足りずに切れた場合は自動で 4 倍ずつ引き上げて再試行するため、通常は指定不要
        maxTokens?: number;
        // 自動引き上げの上限。既定 16000。これを超えても本文が出ないモデルは諦めて失敗として扱う
        maxTokensLimit?: number;
    };

    // サーバー起動時のシリーズ照合パイプライン (featureFlags.seriesLibrary 有効時は既定で動作する)。
    // 作品辞書の自動同期の完了を待ってから、未リンク録画のバックフィルを自動実行する
    seriesStartup?: {
        // false で起動時パイプラインを無効化する (既定 true)
        enable?: boolean;
        // true: シリーズ未リンクの録画を毎回先頭から再照合する / false: 前回の続きから新規録画のみ処理する (既定 true)
        rescanUnlinked?: boolean;
        // 起動からパイプライン開始までの待機 (ms)。既定 420000 (7 分。辞書の初回自動同期の開始後)
        delayMs?: number;
        // 辞書同期の完了待ちの上限 (ms)。既定 1800000 (30 分)
        dictionaryWaitMs?: number;
    };

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

    // データ放送 (BML) 配信 (featureFlags.dataBroadcasting が有効な場合のみ意味を持つ)
    dataBroadcasting?: {
        // WebSocket 経由のデータ放送ストリーム同時本数上限。既定 4。
        // 上限を超えると最も古いストリームを閉じて新しい要求を受け付ける
        maxStreams?: number;
    };
}
