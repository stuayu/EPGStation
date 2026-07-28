/**
 * config.yml をフォームで編集するための項目定義。
 * サーバ側の編集可能キー (src/model/config/ConfigOverlay.ts の CONFIG_OVERLAY_FIELDS) と
 * 対応させること。ここに無いキーは画面から編集できない
 */

export interface ConfigFormField {
    // config 内のパス ('a.b' 形式)
    path: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'select' | 'lines';
    // type が 'lines' のときの要素の型
    itemType?: 'string' | 'number';
    // type が 'select' のときの選択肢
    items?: Array<{ title: string; value: string | number }>;
    hint?: string;
    // パスワード欄として扱う
    secret?: boolean;
}

export interface ConfigFormSection {
    title: string;
    fields: ConfigFormField[];
}

export const CONFIG_FORM_SECTIONS: ConfigFormSection[] = [
    {
        title: '基本',
        fields: [
            { path: 'port', label: 'ポート番号', type: 'number' },
            { path: 'socketioPort', label: 'socket.io ポート (省略時は同じポート)', type: 'number' },
            { path: 'clientSocketioPort', label: 'クライアントが接続する socket.io ポート', type: 'number' },
            { path: 'subDirectory', label: 'サブディレクトリ', hint: 'リバースプロキシ配下で /epg などに置く場合', type: 'string' },
            { path: 'mirakurunPath', label: 'Mirakurun のパス', type: 'string' },
            { path: 'mirakurunAPIPath', label: 'Mirakurun の API ベースパス (省略時 /api)', type: 'string' },
            { path: 'apiServers', label: 'API サーバ URL (1 行 1 件)', type: 'lines' },
            { path: 'isAllowAllCORS', label: 'すべてのオリジンからのアクセスを許可する', type: 'boolean' },
            { path: 'epgUpdateIntervalTime', label: 'EPG 更新間隔 (分)', type: 'number' },
            { path: 'needToReplaceEnclosingCharacters', label: '番組情報の囲み文字を [] に置換する', type: 'boolean' },
            { path: 'isSuppressReservesUpdateAllLog', label: '予約定期更新のログを抑制する', type: 'boolean' },
        ],
    },
    {
        title: '放送局',
        fields: [
            { path: 'channelOrder', label: '放送局の並び順 (channelId を 1 行 1 件)', type: 'lines', itemType: 'number' },
            { path: 'sidOrder', label: 'サービス ID の並び順 (1 行 1 件)', type: 'lines', itemType: 'number' },
            { path: 'excludeChannels', label: '除外する放送局 (channelId を 1 行 1 件)', type: 'lines', itemType: 'number' },
            { path: 'excludeSids', label: '除外するサービス ID (1 行 1 件)', type: 'lines', itemType: 'number' },
        ],
    },
    {
        title: '優先度・マージン',
        fields: [
            { path: 'recPriority', label: '録画の優先度', type: 'number' },
            { path: 'conflictPriority', label: '競合時の優先度', type: 'number' },
            { path: 'streamingPriority', label: '視聴の優先度', type: 'number' },
            { path: 'timeSpecifiedStartMargin', label: '時刻指定予約の開始マージン (秒)', type: 'number' },
            { path: 'timeSpecifiedEndMargin', label: '時刻指定予約の終了マージン (秒)', type: 'number' },
        ],
    },
    {
        title: '録画',
        fields: [
            { path: 'recordedFormat', label: '録画ファイル名フォーマット', type: 'string' },
            { path: 'recordedFileExtension', label: '録画ファイルの拡張子', type: 'string' },
            { path: 'recordedTmp', label: '録画一時ディレクトリ', type: 'string' },
            { path: 'recordedHistoryRetentionPeriodDays', label: '録画履歴の保存期間 (日)', type: 'number' },
            { path: 'storageLimitCheckIntervalTime', label: 'ストレージ空き容量チェック間隔 (秒)', type: 'number' },
            { path: 'isEnabledDropCheck', label: 'ドロップチェックを有効にする', type: 'boolean' },
            { path: 'dropLog', label: 'ドロップログの保存先', type: 'string' },
        ],
    },
    {
        title: '録画開始のリトライ',
        fields: [
            {
                path: 'recording.startWaitLimitMs',
                label: '番組開始を待つ上限 (ms)',
                hint: '前の番組の延長 (放送時刻未定) で開始が遅れている場合に待つ時間。既定 3 時間 (10800000)。0 で待たない',
                type: 'number',
            },
            {
                path: 'recording.startWaitIntervalMs',
                label: '開始待ち中の再試行間隔 (ms)',
                hint: '既定 60000',
                type: 'number',
            },
            {
                path: 'recording.firstDataTimeoutMs',
                label: '最初のデータを待つ時間 (ms)',
                hint: 'これを超えたら「まだ番組が始まっていない」と判断する。既定 5000',
                type: 'number',
            },
            {
                path: 'recording.errorFastRetryCount',
                label: 'チューナー異常時の再試行回数 (短間隔)',
                hint: '既定 3',
                type: 'number',
            },
            { path: 'recording.errorFastRetryIntervalMs', label: '同・間隔 (ms)', hint: '既定 5000', type: 'number' },
            {
                path: 'recording.errorRetryCount',
                label: 'チューナー異常時の再試行回数 (長間隔)',
                hint: '既定 27',
                type: 'number',
            },
            { path: 'recording.errorRetryIntervalMs', label: '同・間隔 (ms)', hint: '既定 60000', type: 'number' },
        ],
    },
    {
        title: '外部録画ファイルの取り込み',
        fields: [
            { path: 'importDefaultMode', label: '取り込みの既定動作', type: 'select', items: [
                { title: '登録のみ (元ファイルを移動しない)', value: 'register' },
                { title: '録画ディレクトリへ移動', value: 'move' },
            ] },
            { path: 'importWatch', label: '取り込みディレクトリを自動監視する', type: 'boolean' },
            { path: 'importWatchIntervalSec', label: '自動監視の間隔 (秒)', type: 'number' },
            { path: 'importFileNamePatterns', label: 'ファイル名の推定パターン (1 行 1 件)', type: 'lines' },
        ],
    },
    {
        title: 'サムネイル',
        fields: [
            { path: 'thumbnail', label: 'サムネイルの保存先', type: 'string' },
            { path: 'thumbnailCmd', label: 'サムネイル生成コマンド', type: 'string' },
            { path: 'thumbnailSize', label: 'サムネイルのサイズ', hint: '例: 480x270', type: 'string' },
            { path: 'thumbnailPosition', label: '切り出し位置 (秒)', type: 'number' },
        ],
    },
    {
        title: '外部コマンド',
        fields: [
            { path: 'ffmpeg', label: 'ffmpeg のパス', type: 'string' },
            { path: 'ffprobe', label: 'ffprobe のパス', type: 'string' },
            { path: 'tsreadex', label: 'tsreadex のパス (省略時は PATH 上)', type: 'string' },
            { path: 'uploadTempDir', label: 'アップロード一時ディレクトリ', type: 'string' },
        ],
    },
    {
        title: 'エンコード・配信',
        fields: [
            { path: 'encodeProcessNum', label: '録画ファイルのエンコード最大プロセス数', type: 'number' },
            { path: 'streamProcessNum', label: '視聴用ストリーミングの最大プロセス数', type: 'number' },
            { path: 'concurrentEncodeNum', label: '同時エンコード数', type: 'number' },
            { path: 'streamFilePath', label: 'ストリーミング用一時ファイルの保存先', type: 'string' },
        ],
    },
    {
        title: '更新通知',
        fields: [
            { path: 'updateChecker.repository', label: '監視するリポジトリ', hint: 'owner/repo 形式', type: 'string' },
            { path: 'updateChecker.branch', label: '追従するブランチ', type: 'string' },
            { path: 'updateChecker.checkIntervalMs', label: 'チェック間隔 (ms、0 で停止)', type: 'number' },
            { path: 'updateChecker.includePrerelease', label: 'プレリリースも通知する', type: 'boolean' },
        ],
    },
    {
        title: 'シリーズ名の LLM 抽出',
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
        title: '外部コマンド実行',
        fields: [
            { path: 'reserveNewAddtionCommand', label: '予約が新規追加されたとき', type: 'string' },
            { path: 'reserveUpdateCommand', label: '予約情報が更新されたとき', type: 'string' },
            { path: 'reservedeletedCommand', label: '予約が削除されたとき', type: 'string' },
            { path: 'recordingPreStartCommand', label: '録画準備を開始したとき', type: 'string' },
            { path: 'recordingPrepRecFailedCommand', label: '録画準備に失敗したとき', type: 'string' },
            { path: 'recordingStartCommand', label: '録画を開始したとき', type: 'string' },
            { path: 'recordingFinishCommand', label: '録画が終了したとき', type: 'string' },
            { path: 'recordingFailedCommand', label: '録画中にエラーが起きたとき', type: 'string' },
            { path: 'encodingFinishCommand', label: 'エンコードが終了したとき', type: 'string' },
        ],
    },
    {
        title: '機能フラグ',
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
        ],
    },
];
