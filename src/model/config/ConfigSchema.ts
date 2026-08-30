import IConfigFile from '../IConfigFile';

/**
 * config.yml の設定項目に関する単一の宣言的スキーマ定義。
 *
 * 従来はキー / 型 / ラベル / 編集可否といった情報が
 * IConfigFile の型定義・ConfigOverlay の GUI 編集可能キー一覧・
 * 画面側のフォームフィールド定義 (旧 client/src/util/ConfigFormFields.ts) の
 * 3 箇所に分散しており、追加漏れや表記ゆれの原因になっていた。
 * このファイルを唯一の定義元とし、サーバーの検証・API 応答・画面描画の
 * すべてをここから導出する。
 *
 * 実効値は次の 3 層を config.yml → DB オーバーレイの順に重ねて決まる:
 *   1. 既定値 (Configuration.DEFAULT_VALUE)
 *   2. config.yml (手編集ファイル)
 *   3. DB オーバーレイ (app_setting.config。画面からの変更はここに入る)
 *
 * GUI から編集できないキー (editable: 'ymlOnly') は、理由 (reason) を必ず添える。
 * config.yml を手編集する運用は変更しない (後方互換)。
 */

/** 画面のフォームで描画する際の入力タイプ */
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'select' | 'lines';

/**
 * スキーマ項目の中の 1 入力欄の定義。
 * 単純なスカラー項目は key と同じ 1 つの path を持つ。
 * recording / featureFlags / updateChecker / seriesLlm のようなオブジェクト項目は
 * 複数の path (例: 'recording.errorRetryCount') を持つ。
 */
export interface ConfigSchemaFieldDefinition {
    // config 内のパス ('a.b' 形式)
    path: string;
    label: string;
    type: ConfigFieldType;
    // type が 'lines' のときの要素の型
    itemType?: 'string' | 'number';
    // type が 'select' のときの選択肢
    items?: Array<{ title: string; value: string | number }>;
    hint?: string;
    // パスワード欄など、画面・API 応答でマスクすべき項目
    secret?: boolean;
}

export type ConfigEditable = 'gui' | 'ymlOnly';

/** GUI から編集できない理由コード */
export type YmlOnlyReasonCode = 'selfReference' | 'authLockout' | 'shadowedByAppSetting' | 'notYetWired';

/** 理由コードに対応する、利用者向けの日本語説明文 (API 応答・画面表示の両方で共用する) */
export const YML_ONLY_REASONS: Readonly<Record<YmlOnlyReasonCode, string>> = {
    selfReference:
        'オーバーレイ自体をこのキーの設定に従って DB から読み込むため、画面から誤った値を保存すると次回起動時に設定を読み出せず復旧できなくなります (自己参照)。config.yml を直接編集してください。',
    authLockout:
        'ログイン認証は画面に入るための手段そのものであり、画面から変更できるとロックアウトの危険があります。config.yml を直接編集してください。',
    shadowedByAppSetting: '画面 (システム設定) 側に対応する項目があり、そちらが未入力のときにのみ使われる既定値です。',
    notYetWired: '現時点では画面に対応する編集 UI が用意されていません。config.yml を直接編集してください。',
};

/**
 * 理由コードの性質による分類。
 * - safety: 恒久的な安全上の制約 (自己参照・ロックアウト等)。将来も GUI 化しない
 * - notImplemented: 単に GUI 側の実装が追いついていないだけで、将来 GUI 化しうる
 *
 * `shadowedByAppSetting` は「danger ではない」という意味で notImplemented 側に分類する。
 * 画面 (システム設定) に対応項目があり config.yml 側は未入力時のフォールバックに過ぎないため、
 * 安全上 GUI 化できないわけではなく、対応項目の入力欄をこちらにも足せば GUI 化しうる
 */
export const YML_ONLY_REASON_CATEGORY: Readonly<Record<YmlOnlyReasonCode, 'safety' | 'notImplemented'>> = {
    selfReference: 'safety',
    authLockout: 'safety',
    shadowedByAppSetting: 'notImplemented',
    notYetWired: 'notImplemented',
};

export interface ConfigSchemaEntry {
    // config.yml のトップレベルキー
    key: keyof IConfigFile;
    label: string;
    hint?: string;
    // 変更に EPGStation の再起動が必要か (起動時にしか読まれない項目)
    requiresRestart: boolean;
    // 'gui': 画面 (DB オーバーレイ) から編集可能 / 'ymlOnly': config.yml でのみ設定可能
    editable: ConfigEditable;
    // editable が 'ymlOnly' のときに必須
    reason?: YmlOnlyReasonCode;
    // editable が 'gui' のときの入力欄一覧。専用の Vue コンポーネントで編集する項目 (recorded / encode / stream 等) は空配列
    fields?: ConfigSchemaFieldDefinition[];
    // editable: 'gui' かつ fields: [] のとき、画面の汎用フォームではなく専用の Vue コンポーネントで編集することを示す。
    // これが無いのに fields: [] な 'gui' エントリは「GUI 編集可能だが対応する編集 UI が未実装」を意味し、
    // 画面のどこにも表示されない (指摘 3)。専用コンポーネントを持つ項目 (recorded / encode / stream) にのみ付ける
    customEditor?: boolean;
}

export const CONFIG_SCHEMA: readonly ConfigSchemaEntry[] = [
    {
        key: 'port',
        label: 'ポート番号',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'port', label: 'ポート番号', type: 'number' }],
    },
    {
        key: 'socketioPort',
        label: 'socket.io ポート (省略時は同じポート)',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'socketioPort', label: 'socket.io ポート (省略時は同じポート)', type: 'number' }],
    },
    {
        key: 'clientSocketioPort',
        label: 'クライアントが接続する socket.io ポート',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'clientSocketioPort', label: 'クライアントが接続する socket.io ポート', type: 'number' }],
    },
    {
        key: 'subDirectory',
        label: 'サブディレクトリ',
        hint: 'リバースプロキシ配下で /epg などに置く場合',
        requiresRestart: true,
        editable: 'gui',
        fields: [
            {
                path: 'subDirectory',
                label: 'サブディレクトリ',
                type: 'string',
                hint: 'リバースプロキシ配下で /epg などに置く場合',
            },
        ],
    },
    {
        key: 'apiServers',
        label: 'API サーバ URL (1 行 1 件)',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'apiServers', label: 'API サーバ URL (1 行 1 件)', type: 'lines' }],
    },
    {
        key: 'isAllowAllCORS',
        label: 'すべてのオリジンからのアクセスを許可する',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'isAllowAllCORS', label: 'すべてのオリジンからのアクセスを許可する', type: 'boolean' }],
    },
    {
        key: 'mirakurunPath',
        label: 'Mirakurun のパス',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'mirakurunPath', label: 'Mirakurun のパス', type: 'string' }],
    },
    {
        key: 'mirakurunAPIPath',
        label: 'Mirakurun の API ベースパス (省略時 /api)',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'mirakurunAPIPath', label: 'Mirakurun の API ベースパス (省略時 /api)', type: 'string' }],
    },
    {
        key: 'tunerServerType',
        label: 'チューナーサーバーの種別',
        hint: '省略時 (自動判定) は getServerConfig() の成否で mirakurun / mirakc を判定する。互換実装の検証時などに固定したい場合に指定する',
        requiresRestart: true,
        editable: 'gui',
        fields: [
            {
                path: 'tunerServerType',
                label: 'チューナーサーバーの種別',
                type: 'select',
                items: [
                    { title: '自動判定', value: 'auto' },
                    { title: 'Mirakurun', value: 'mirakurun' },
                    { title: 'mirakc', value: 'mirakc' },
                ],
                hint: '省略時 (自動判定) は getServerConfig() の成否で mirakurun / mirakc を判定する。互換実装の検証時などに固定したい場合に指定する',
            },
        ],
    },
    {
        key: 'epgUpdateIntervalTime',
        label: 'EPG 更新間隔 (分)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'epgUpdateIntervalTime', label: 'EPG 更新間隔 (分)', type: 'number' }],
    },
    {
        key: 'epgFullRefreshIntervalTime',
        label: 'EPG 全件突き合わせ間隔 (分)',
        hint: '省略時 360 (6 時間)。0 で無効',
        requiresRestart: true,
        editable: 'gui',
        fields: [
            {
                path: 'epgFullRefreshIntervalTime',
                label: 'EPG 全件突き合わせ間隔 (分)',
                type: 'number',
                hint: 'event stream が動いていても定期的に Mirakurun から全件取り直す。省略時 360 (6 時間)。0 で無効',
            },
        ],
    },
    {
        key: 'epgRetentionTime',
        label: '過去の番組表データの保存期間 (時間)',
        hint: '0: 終了した番組を即座に削除 (従来動作) / -1: 削除しない (無期限)',
        requiresRestart: true,
        editable: 'gui',
        fields: [
            {
                path: 'epgRetentionTime',
                label: '過去の番組表データの保存期間 (時間)',
                type: 'number',
                hint: '0: 終了した番組を即座に削除 (従来動作) / -1: 削除しない (無期限)',
            },
        ],
    },
    {
        key: 'epgDeleteIntervalTime',
        label: '過去の番組表データを削除する間隔 (分)',
        hint: '省略時は EPG 更新間隔と同じ',
        requiresRestart: true,
        editable: 'gui',
        fields: [
            {
                path: 'epgDeleteIntervalTime',
                label: '過去の番組表データを削除する間隔 (分)',
                type: 'number',
                hint: '省略時は EPG 更新間隔と同じ',
            },
        ],
    },
    {
        key: 'epgRealtime',
        label: 'EPG リアルタイム同期',
        hint: '災害時の特番割り込みや前番組の延長による番組情報の変更を、EPG 更新間隔を待たず即座に反映する (有効・無効は機能フラグ epgRealtimeSync)',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'epgRealtime.debounceMs',
                label: '先行反映までの待ち時間 (ms)',
                type: 'number',
                hint: '連続して届く更新を 1 回の DB 更新にまとめるための待ち時間。既定 500',
            },
            {
                path: 'epgRealtime.minIntervalMs',
                label: '先行反映の最小間隔 (ms)',
                type: 'number',
                hint: '既定 500。EPG が大量に流入したときに DB 更新が張り付かないよう間隔を空ける',
            },
            {
                path: 'epgRealtime.urgentWindowMinutes',
                label: '即時反映の対象とする時間 (分)',
                type: 'number',
                hint: 'これ以内に始まる番組の変更を即時反映する。既定 180 (放送時間未定への変更・番組の消滅は時間帯に関わらず即時反映)',
            },
        ],
    },
    {
        key: 'needToReplaceEnclosingCharacters',
        label: '番組情報の囲み文字を [] に置換する',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            { path: 'needToReplaceEnclosingCharacters', label: '番組情報の囲み文字を [] に置換する', type: 'boolean' },
        ],
    },
    {
        key: 'isHideDuplicateSubChannel',
        label: '内容が同じサブチャンネルを番組表・放映中に表示しない',
        hint: '親チャンネルと同じ番組しか流していないサブチャンネル (○○２ / ○○３ など) の列を隠す。サブチャンネルが別番組を放送しているときは表示される',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'isHideDuplicateSubChannel',
                label: '内容が同じサブチャンネルを番組表・放映中に表示しない',
                type: 'boolean',
            },
        ],
    },
    {
        key: 'isSuppressReservesUpdateAllLog',
        label: '予約定期更新のログを抑制する',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'isSuppressReservesUpdateAllLog', label: '予約定期更新のログを抑制する', type: 'boolean' }],
    },
    {
        key: 'channelOrder',
        label: '放送局の並び順 (channelId を 1 行 1 件)',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'channelOrder',
                label: '放送局の並び順 (channelId を 1 行 1 件)',
                type: 'lines',
                itemType: 'number',
            },
        ],
    },
    {
        key: 'sidOrder',
        label: 'サービス ID の並び順 (1 行 1 件)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'sidOrder', label: 'サービス ID の並び順 (1 行 1 件)', type: 'lines', itemType: 'number' }],
    },
    {
        key: 'excludeChannels',
        label: '除外する放送局 (channelId を 1 行 1 件)',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'excludeChannels',
                label: '除外する放送局 (channelId を 1 行 1 件)',
                type: 'lines',
                itemType: 'number',
            },
        ],
    },
    {
        key: 'excludeSids',
        label: '除外するサービス ID (1 行 1 件)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'excludeSids', label: '除外するサービス ID (1 行 1 件)', type: 'lines', itemType: 'number' }],
    },
    {
        key: 'recPriority',
        label: '録画の優先度',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'recPriority', label: '録画の優先度', type: 'number' }],
    },
    {
        key: 'conflictPriority',
        label: '競合時の優先度',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'conflictPriority', label: '競合時の優先度', type: 'number' }],
    },
    {
        key: 'streamingPriority',
        label: '視聴の優先度',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'streamingPriority', label: '視聴の優先度', type: 'number' }],
    },
    {
        key: 'timeSpecifiedStartMargin',
        label: '時刻指定予約の開始マージン (秒)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'timeSpecifiedStartMargin', label: '時刻指定予約の開始マージン (秒)', type: 'number' }],
    },
    {
        key: 'timeSpecifiedEndMargin',
        label: '時刻指定予約の終了マージン (秒)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'timeSpecifiedEndMargin', label: '時刻指定予約の終了マージン (秒)', type: 'number' }],
    },
    {
        key: 'recordedFormat',
        label: '録画ファイル名フォーマット',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'recordedFormat', label: '録画ファイル名フォーマット', type: 'string' }],
    },
    {
        key: 'recordedFileExtension',
        label: '録画ファイルの拡張子',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'recordedFileExtension', label: '録画ファイルの拡張子', type: 'string' }],
    },
    {
        key: 'recorded',
        label: '録画ディレクトリ',
        hint: '録画ファイルの保存先一覧。画面の「録画ディレクトリ」パネルで編集します',
        requiresRestart: true,
        editable: 'gui',
        fields: [],
        customEditor: true,
    },
    {
        key: 'recordedTmp',
        label: '録画一時ディレクトリ',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'recordedTmp', label: '録画一時ディレクトリ', type: 'string' }],
    },
    {
        key: 'recordedHistoryRetentionPeriodDays',
        label: '録画履歴の保存期間 (日)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'recordedHistoryRetentionPeriodDays', label: '録画履歴の保存期間 (日)', type: 'number' }],
    },
    // RecorderModel は予約ごとに生成され、そのたびに config を読むため再起動不要
    {
        key: 'recording',
        label: '録画開始のリトライ設定',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'recording.programStreamMode',
                label: 'programId 予約のストリーム方式',
                type: 'select',
                items: [
                    { value: 'service', title: 'サービスストリーム (推奨)' },
                    { value: 'program', title: '番組ストリーム (切り戻し)' },
                ],
            },
            {
                path: 'recording.startWaitLimitMs',
                label: '番組開始を待つ上限 (ms)',
                type: 'number',
                hint: '前の番組の延長 (放送時刻未定) で開始が遅れている場合に待つ時間。既定 3 時間 (10800000)。0 で待たない',
            },
            {
                path: 'recording.startWaitIntervalMs',
                label: '開始待ち中の再試行間隔 (ms)',
                type: 'number',
                hint: '既定 60000',
            },
            {
                path: 'recording.firstDataTimeoutMs',
                label: '最初のデータを待つ時間 (ms)',
                type: 'number',
                hint: 'これを超えたら「まだ番組が始まっていない」と判断する。既定 5000',
            },
            {
                path: 'recording.errorFastRetryCount',
                label: 'チューナー異常時の再試行回数 (短間隔)',
                type: 'number',
                hint: '既定 3',
            },
            { path: 'recording.errorFastRetryIntervalMs', label: '同・間隔 (ms)', type: 'number', hint: '既定 5000' },
            {
                path: 'recording.errorRetryCount',
                label: 'チューナー異常時の再試行回数 (長間隔)',
                type: 'number',
                hint: '既定 27',
            },
            { path: 'recording.errorRetryIntervalMs', label: '同・間隔 (ms)', type: 'number', hint: '既定 60000' },
            { path: 'recording.startGateEnabled', label: 'EIT 開始ゲート', type: 'boolean' },
            {
                path: 'recording.startGateTimeoutMs',
                label: 'EIT soft timeout (ms)',
                type: 'number',
                hint: '既定 60000',
            },
            {
                path: 'recording.hardStartGateTimeoutMs',
                label: 'EIT hard timeout (ms)',
                type: 'number',
                hint: '既定 300000',
            },
            {
                path: 'recording.startGateStartMarginMs',
                label: 'EIT 開始時刻の許容差 (ms)',
                type: 'number',
                hint: '既定 120000',
            },
            {
                path: 'recording.storageFallbackEnabled',
                label: '空き容量不足で次の録画先へ振り替える',
                type: 'boolean',
                hint: '既定 有効',
            },
            {
                path: 'recording.storageFallbackMarginMB',
                label: '予想録画サイズに上乗せする余裕 (MB)',
                type: 'number',
                hint: '既定 3072',
            },
            {
                path: 'recording.storageFallbackBitrateMbps',
                label: '予想サイズ計算のビットレート (Mbps)',
                type: 'number',
                hint: '省略時は放送種別ごとの既定値 (GR 19 / BS 26 / CS・SKY 20 / 4K 40)',
            },
            {
                path: 'recording.prepRecSec',
                label: '開始時刻の何秒前から張り付くか',
                type: 'number',
                hint: '既定 15。チャンネルを開いて EIT[p/f] の監視を始める時刻。負値不可',
            },
            {
                path: 'recording.startMarginSec',
                label: '開始時刻の何秒前から録画するか',
                type: 'number',
                hint: '既定 0。負値不可',
            },
            {
                path: 'recording.endMarginSec',
                label: '終了時刻の何秒後まで録画するか',
                type: 'number',
                hint: '既定 0。負値不可',
            },
        ],
    },
    {
        key: 'storageLimitCheckIntervalTime',
        label: 'ストレージ空き容量チェック間隔 (秒)',
        requiresRestart: true,
        editable: 'gui',
        fields: [
            { path: 'storageLimitCheckIntervalTime', label: 'ストレージ空き容量チェック間隔 (秒)', type: 'number' },
        ],
    },
    {
        key: 'isEnabledDropCheck',
        label: 'ドロップチェックを有効にする',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'isEnabledDropCheck', label: 'ドロップチェックを有効にする', type: 'boolean' }],
    },
    {
        key: 'dropLog',
        label: 'ドロップログの保存先',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'dropLog', label: 'ドロップログの保存先', type: 'string' }],
    },
    {
        key: 'importDirs',
        label: '外部録画ファイルの取り込みディレクトリ',
        requiresRestart: true,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'importDefaultMode',
        label: '取り込みの既定動作',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'importDefaultMode',
                label: '取り込みの既定動作',
                type: 'select',
                items: [
                    { title: '登録のみ (元ファイルを移動しない)', value: 'register' },
                    { title: '録画ディレクトリへ移動', value: 'move' },
                ],
            },
        ],
    },
    {
        key: 'importFileNamePatterns',
        label: 'ファイル名の推定パターン (1 行 1 件)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'importFileNamePatterns', label: 'ファイル名の推定パターン (1 行 1 件)', type: 'lines' }],
    },
    {
        key: 'importWatch',
        label: '取り込みディレクトリを自動監視する',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'importWatch', label: '取り込みディレクトリを自動監視する', type: 'boolean' }],
    },
    {
        key: 'importWatchIntervalSec',
        label: '自動監視の間隔 (秒)',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'importWatchIntervalSec', label: '自動監視の間隔 (秒)', type: 'number' }],
    },
    {
        key: 'thumbnail',
        label: 'サムネイルの保存先',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'thumbnail', label: 'サムネイルの保存先', type: 'string' }],
    },
    {
        key: 'thumbnailCmd',
        label: 'サムネイル生成コマンド',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'thumbnailCmd', label: 'サムネイル生成コマンド', type: 'string' }],
    },
    {
        key: 'thumbnailSize',
        label: 'サムネイルのサイズ',
        hint: '例: 480x270',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'thumbnailSize', label: 'サムネイルのサイズ', type: 'string', hint: '例: 480x270' }],
    },
    {
        key: 'thumbnailPosition',
        label: '切り出し位置 (秒)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'thumbnailPosition', label: '切り出し位置 (秒)', type: 'number' }],
    },
    {
        key: 'thumbnailFormat',
        label: 'サムネイル形式',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'thumbnailFormat',
                label: 'サムネイル形式',
                type: 'select',
                items: [
                    { title: 'JPEG', value: 'jpeg' },
                    { title: 'WebP', value: 'webp' },
                ],
            },
        ],
    },
    {
        key: 'thumbnailProfile',
        label: 'サムネイル品質プロファイル',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'thumbnailProfile',
                label: 'サムネイル品質プロファイル',
                type: 'select',
                items: [
                    { title: 'Fast', value: 'fast' },
                    { title: 'Balanced', value: 'balanced' },
                    { title: 'Quality', value: 'quality' },
                ],
            },
        ],
    },
    {
        key: 'thumbnailCandidateCount',
        label: 'サムネイル候補数',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'thumbnailCandidateCount', label: 'サムネイル候補数', type: 'number' }],
    },
    {
        key: 'thumbnailSearchDuration',
        label: 'サムネイル探索範囲 (秒)',
        hint: '録画先頭から候補を探す範囲。0 で全編、既定 1200 秒',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            {
                path: 'thumbnailSearchDuration',
                label: 'サムネイル探索範囲 (秒)',
                type: 'number',
                hint: '0 で全編、既定 1200',
            },
        ],
    },
    {
        key: 'thumbnailStorageRoot',
        label: 'サムネイルキャッシュ保存先',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'thumbnailStorageRoot', label: 'サムネイルキャッシュ保存先', type: 'string' }],
    },
    {
        key: 'thumbnailPosterWidth',
        label: 'poster 保存幅',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'thumbnailPosterWidth', label: 'poster 保存幅', type: 'number' }],
    },
    {
        key: 'ffmpeg',
        label: 'ffmpeg のパス',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'ffmpeg', label: 'ffmpeg のパス', type: 'string' }],
    },
    {
        key: 'ffprobe',
        label: 'ffprobe のパス',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'ffprobe', label: 'ffprobe のパス', type: 'string' }],
    },
    {
        key: 'audioBoost',
        label: '配信音声ブースト倍率',
        hint: 'ライブ・録画再生の配信音声に適用する倍率。既定 2.0、1.0 で無効、上限 4.0。保存用エンコードには適用しない',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'audioBoost', label: '配信音声ブースト倍率', type: 'number' }],
    },
    {
        key: 'ffprobeTimeout',
        label: 'ffprobe のタイムアウト (秒)',
        hint: '壊れた動画や応答しないストレージで解析が止まらないようにする上限時間。既定 30 秒',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'ffprobeTimeout', label: 'ffprobe のタイムアウト (秒)', type: 'number' }],
    },
    {
        key: 'tsreadex',
        label: 'tsreadex のパス (省略時は PATH 上)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'tsreadex', label: 'tsreadex のパス (省略時は PATH 上)', type: 'string' }],
    },
    {
        key: 'qsvencc',
        label: 'QSVEncC のパス (省略時は PATH 上)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'qsvencc', label: 'QSVEncC のパス (省略時は PATH 上)', type: 'string' }],
    },
    {
        key: 'nvencc',
        label: 'NVEncC のパス (省略時は PATH 上)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'nvencc', label: 'NVEncC のパス (省略時は PATH 上)', type: 'string' }],
    },
    {
        key: 'vceencc',
        label: 'VCEEncC のパス (省略時は PATH 上)',
        requiresRestart: false,
        editable: 'gui',
        fields: [{ path: 'vceencc', label: 'VCEEncC のパス (省略時は PATH 上)', type: 'string' }],
    },
    {
        key: 'uploadTempDir',
        label: 'アップロード一時ディレクトリ',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'uploadTempDir', label: 'アップロード一時ディレクトリ', type: 'string' }],
    },
    {
        key: 'encodeProcessNum',
        label: '録画ファイルのエンコード最大プロセス数',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'encodeProcessNum', label: '録画ファイルのエンコード最大プロセス数', type: 'number' }],
    },
    {
        key: 'streamProcessNum',
        label: '視聴用ストリーミングの最大プロセス数',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'streamProcessNum', label: '視聴用ストリーミングの最大プロセス数', type: 'number' }],
    },
    {
        key: 'concurrentEncodeNum',
        label: '同時エンコード数',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'concurrentEncodeNum', label: '同時エンコード数', type: 'number' }],
    },
    {
        key: 'encode',
        label: 'エンコード設定 (プリセット一覧)',
        hint: '画面の「エンコード設定」パネルで編集します',
        requiresRestart: false,
        editable: 'gui',
        fields: [],
        customEditor: true,
    },
    // エンコードコマンド (dist/AmatsukazeEncodeTool.js) は独立したプロセスとして起動され、
    // DB オーバーレイを読まずに config.yml だけを読む。画面から変更できると
    // 「画面では変わっているのに実際のエンコードに反映されない」状態になるため yml 限定にする
    {
        key: 'amatsukaze',
        label: 'Amatsukaze 連携',
        hint: 'エンコードコマンドに dist/AmatsukazeEncodeTool.js を指定したときの接続先・投入方法・パス変換',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    // EncodePresets.applyToConfig が formatConfig の都度 encode/stream.profiles を組み立て直すため再起動不要
    {
        key: 'encodePresets',
        label: 'エンコードプリセットの自動生成設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'urlscheme',
        label: '視聴 URL Scheme 設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'streamFilePath',
        label: 'ストリーミング用一時ファイルの保存先',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'streamFilePath', label: 'ストリーミング用一時ファイルの保存先', type: 'string' }],
    },
    {
        key: 'kodiHosts',
        label: '配信先 Kodi 設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    // StreamProfileManageModel は呼び出しのたびに config を読むため再起動不要
    {
        key: 'stream',
        label: '配信プロファイル設定',
        hint: '画面の「配信プロファイル」パネルで編集します',
        requiresRestart: false,
        editable: 'gui',
        fields: [],
        customEditor: true,
    },
    // ExternalCommandManageModel がコンストラクタで config を読むため、以下の外部コマンド系は再起動が必要
    {
        key: 'reserveNewAddtionCommand',
        label: '予約が新規追加されたとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'reserveNewAddtionCommand', label: '予約が新規追加されたとき', type: 'string' }],
    },
    {
        key: 'reserveUpdateCommand',
        label: '予約情報が更新されたとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'reserveUpdateCommand', label: '予約情報が更新されたとき', type: 'string' }],
    },
    {
        key: 'reservedeletedCommand',
        label: '予約が削除されたとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'reservedeletedCommand', label: '予約が削除されたとき', type: 'string' }],
    },
    {
        key: 'recordingPreStartCommand',
        label: '録画準備を開始したとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'recordingPreStartCommand', label: '録画準備を開始したとき', type: 'string' }],
    },
    {
        key: 'recordingPrepRecFailedCommand',
        label: '録画準備に失敗したとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'recordingPrepRecFailedCommand', label: '録画準備に失敗したとき', type: 'string' }],
    },
    {
        key: 'recordingStartCommand',
        label: '録画を開始したとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'recordingStartCommand', label: '録画を開始したとき', type: 'string' }],
    },
    {
        key: 'recordingFinishCommand',
        label: '録画が終了したとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'recordingFinishCommand', label: '録画が終了したとき', type: 'string' }],
    },
    {
        key: 'recordingFailedCommand',
        label: '録画中にエラーが起きたとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'recordingFailedCommand', label: '録画中にエラーが起きたとき', type: 'string' }],
    },
    {
        key: 'encodingFinishCommand',
        label: 'エンコードが終了したとき',
        requiresRestart: true,
        editable: 'gui',
        fields: [{ path: 'encodingFinishCommand', label: 'エンコードが終了したとき', type: 'string' }],
    },
    {
        key: 'featureFlags',
        label: '機能フラグ',
        requiresRestart: true,
        editable: 'gui',
        fields: [
            { path: 'featureFlags.watchHistory', label: '視聴履歴', type: 'boolean' },
            { path: 'featureFlags.notifications', label: '通知 (Webhook / Discord)', type: 'boolean' },
            { path: 'featureFlags.dashboard', label: 'ダッシュボード', type: 'boolean' },
            { path: 'featureFlags.systemSettings', label: 'サーバー設定画面', type: 'boolean' },
            { path: 'featureFlags.seriesLibrary', label: 'シリーズライブラリ', type: 'boolean' },
            { path: 'featureFlags.metadataProviders', label: 'メタデータ連携', type: 'boolean' },
            { path: 'featureFlags.programSeriesMapping', label: '番組⇄シリーズ事前マッピング', type: 'boolean' },
            { path: 'featureFlags.annictSync', label: 'Annict 視聴記録同期', type: 'boolean' },
            { path: 'featureFlags.nextUpPanel', label: '次に見るパネル', type: 'boolean' },
            { path: 'featureFlags.externalFileImport', label: '外部録画ファイルの取り込み', type: 'boolean' },
            { path: 'featureFlags.advancedSearch', label: '保存検索', type: 'boolean' },
            { path: 'featureFlags.updateNotification', label: '更新通知', type: 'boolean' },
            { path: 'featureFlags.dataBroadcasting', label: 'データ放送 (BML)', type: 'boolean' },
            { path: 'featureFlags.epgRealtimeSync', label: 'EPG リアルタイム同期', type: 'boolean' },
        ],
    },
    {
        key: 'updateChecker',
        label: '更新通知',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            { path: 'updateChecker.repository', label: '監視するリポジトリ', type: 'string', hint: 'owner/repo 形式' },
            { path: 'updateChecker.branch', label: '追従するブランチ', type: 'string' },
            { path: 'updateChecker.checkIntervalMs', label: 'チェック間隔 (ms、0 で停止)', type: 'number' },
            { path: 'updateChecker.includePrerelease', label: 'プレリリースも通知する', type: 'boolean' },
        ],
    },
    {
        key: 'seriesLlm',
        label: 'シリーズ名の LLM 抽出',
        requiresRestart: false,
        editable: 'gui',
        fields: [
            { path: 'seriesLlm.url', label: 'OpenAI 互換 API のベース URL', type: 'string' },
            { path: 'seriesLlm.model', label: 'モデル名', type: 'string' },
            { path: 'seriesLlm.apiKey', label: 'API キー', type: 'string', secret: true },
            { path: 'seriesLlm.timeoutMs', label: 'タイムアウト (ms)', type: 'number' },
            { path: 'seriesLlm.minIntervalMs', label: 'リクエスト間隔の下限 (ms)', type: 'number' },
            { path: 'seriesLlm.maxTokens', label: '応答の上限トークン数', type: 'number' },
            { path: 'seriesLlm.maxTokensLimit', label: '自動引き上げの上限', type: 'number' },
        ],
    },
    {
        key: 'dbtype',
        label: 'データベース種別',
        hint: 'sqlite / mysql / postgres',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'selfReference',
    },
    {
        key: 'sqlite',
        label: 'SQLite 接続設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'selfReference',
    },
    {
        key: 'mysql',
        label: 'MySQL 接続設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'selfReference',
    },
    {
        key: 'postgres',
        label: 'PostgreSQL 接続設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'selfReference',
    },
    {
        key: 'auth',
        label: 'ログイン認証設定',
        hint: 'Web UI / API のログイン認証 (既定は無効)',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'authLockout',
    },
    {
        key: 'https',
        label: 'HTTPS (TLS) 証明書設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'metadataChannelMappingPath',
        label: 'しょぼいカレンダー ChID マッピング表ファイルのパス',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'metadataSharedDataUrl',
        label: '共有静的データの取得元 URL',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'metadataSharedDataUpdateIntervalMs',
        label: '共有静的データの自動更新間隔 (ms)',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'uid',
        label: '実行ユーザー (uid)',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'gid',
        label: '実行グループ (gid)',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'notifications',
        label: 'Webhook / Discord 通知 (config.yml 側)',
        hint: '画面 (システム設定) 側にも別の通知設定があります',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'metadataDefaults',
        label: 'メタデータプロバイダーの既定値',
        hint: '画面 (システム設定) 側の対応項目が未入力のときに使われます',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'shadowedByAppSetting',
    },
    {
        key: 'seriesDefaults',
        label: 'シリーズ自動マッピングの既定値',
        hint: '画面 (システム設定) 側の対応項目が未入力のときに使われます',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'shadowedByAppSetting',
    },
    {
        key: 'seriesStartup',
        label: 'サーバー起動時のシリーズ照合パイプライン',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
    {
        key: 'dataBroadcasting',
        label: 'データ放送 (BML) 配信設定',
        requiresRestart: false,
        editable: 'ymlOnly',
        reason: 'notYetWired',
    },
] as const;

export const CONFIG_SCHEMA_BY_KEY: ReadonlyMap<string, ConfigSchemaEntry> = new Map(
    CONFIG_SCHEMA.map(entry => [entry.key as string, entry]),
);
