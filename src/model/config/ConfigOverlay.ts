import IConfigFile from '../IConfigFile';

/**
 * config.yml を GUI から編集するための「重ね書き (オーバーレイ)」の定義。
 *
 * config.yml へは書き戻さない。書き戻すとコメントや書式が失われるうえ、
 * Configuration が fs.watchFile で監視しているため書き込みがリロードを誘発する。
 * 代わりに GUI で変更した値だけを DB (app_setting の config キー) に持ち、
 * 読み込み時に「config.yml → DB の値」の順で重ねて実効値を作る。
 *
 * これにより手編集派の config.yml はそのまま残り、GUI 派は画面だけで完結できる。
 */

export interface ConfigFieldDefinition {
    // config.yml のトップレベルキー
    key: keyof IConfigFile;
    // 変更に EPGStation の再起動が必要か (起動時にしか読まれない項目)
    requiresRestart: boolean;
}

/**
 * GUI から編集できるトップレベルキー。
 *
 * **DB 接続設定 (dbtype / mysql / sqlite / postgres) は意図的に含めない**。
 * オーバーレイ自体を DB から読むため、誤った接続設定を保存すると次回起動時に
 * 値を読み出せず復旧できなくなる (自己参照の詰み) ため。
 * 認証設定 (auth) も、画面へ入る手段そのものなので config.yml 専用にしている。
 */
export const CONFIG_OVERLAY_FIELDS: readonly ConfigFieldDefinition[] = [
    // --- 基本 ---
    { key: 'port', requiresRestart: true },
    { key: 'socketioPort', requiresRestart: true },
    { key: 'clientSocketioPort', requiresRestart: true },
    { key: 'subDirectory', requiresRestart: true },
    { key: 'apiServers', requiresRestart: true },
    { key: 'isAllowAllCORS', requiresRestart: true },
    { key: 'mirakurunPath', requiresRestart: true },
    { key: 'mirakurunAPIPath', requiresRestart: true },
    { key: 'epgUpdateIntervalTime', requiresRestart: false },
    { key: 'epgRetentionTime', requiresRestart: true },
    { key: 'epgDeleteIntervalTime', requiresRestart: true },
    { key: 'needToReplaceEnclosingCharacters', requiresRestart: false },
    { key: 'isSuppressReservesUpdateAllLog', requiresRestart: false },

    // --- 放送局 ---
    { key: 'channelOrder', requiresRestart: false },
    { key: 'sidOrder', requiresRestart: false },
    { key: 'excludeChannels', requiresRestart: false },
    { key: 'excludeSids', requiresRestart: false },

    // --- 優先度・マージン ---
    { key: 'recPriority', requiresRestart: false },
    { key: 'conflictPriority', requiresRestart: false },
    { key: 'streamingPriority', requiresRestart: false },
    { key: 'timeSpecifiedStartMargin', requiresRestart: false },
    { key: 'timeSpecifiedEndMargin', requiresRestart: false },

    // --- 録画 ---
    { key: 'recordedFormat', requiresRestart: false },
    { key: 'recordedFileExtension', requiresRestart: false },
    { key: 'recorded', requiresRestart: true },
    { key: 'recordedTmp', requiresRestart: true },
    { key: 'recordedHistoryRetentionPeriodDays', requiresRestart: false },
    // RecorderModel は予約ごとに生成され、そのたびに config を読むため再起動不要
    { key: 'recording', requiresRestart: false },
    { key: 'storageLimitCheckIntervalTime', requiresRestart: true },
    { key: 'isEnabledDropCheck', requiresRestart: false },
    { key: 'dropLog', requiresRestart: true },

    // --- 外部ファイル取り込み ---
    { key: 'importDirs', requiresRestart: true },
    { key: 'importDefaultMode', requiresRestart: false },
    { key: 'importFileNamePatterns', requiresRestart: false },
    { key: 'importWatch', requiresRestart: true },
    { key: 'importWatchIntervalSec', requiresRestart: true },

    // --- サムネイル ---
    { key: 'thumbnail', requiresRestart: true },
    { key: 'thumbnailCmd', requiresRestart: false },
    { key: 'thumbnailSize', requiresRestart: false },
    { key: 'thumbnailPosition', requiresRestart: false },

    // --- 外部コマンド ---
    { key: 'ffmpeg', requiresRestart: false },
    { key: 'ffprobe', requiresRestart: false },
    { key: 'tsreadex', requiresRestart: false },
    // rigaya 系エンコーダ (encodePresets.hwaccel が qsvencc/nvencc/vceencc のときに使う実行ファイルパス)
    { key: 'qsvencc', requiresRestart: false },
    { key: 'nvencc', requiresRestart: false },
    { key: 'vceencc', requiresRestart: false },
    { key: 'uploadTempDir', requiresRestart: true },

    // --- エンコード ---
    { key: 'encodeProcessNum', requiresRestart: true },
    { key: 'streamProcessNum', requiresRestart: true },
    { key: 'concurrentEncodeNum', requiresRestart: true },
    { key: 'encode', requiresRestart: false },
    // EncodePresets.applyToConfig が formatConfig の都度 encode/stream.profiles を組み立て直すため再起動不要
    { key: 'encodePresets', requiresRestart: false },

    // --- 視聴・配信 ---
    { key: 'urlscheme', requiresRestart: false },
    { key: 'streamFilePath', requiresRestart: true },
    { key: 'kodiHosts', requiresRestart: false },
    // StreamProfileManageModel は呼び出しのたびに config を読むため再起動不要
    { key: 'stream', requiresRestart: false },

    // --- 外部コマンド実行 ---
    // ExternalCommandManageModel がコンストラクタで config を読むため再起動が必要
    { key: 'reserveNewAddtionCommand', requiresRestart: true },
    { key: 'reserveUpdateCommand', requiresRestart: true },
    { key: 'reservedeletedCommand', requiresRestart: true },
    { key: 'recordingPreStartCommand', requiresRestart: true },
    { key: 'recordingPrepRecFailedCommand', requiresRestart: true },
    { key: 'recordingStartCommand', requiresRestart: true },
    { key: 'recordingFinishCommand', requiresRestart: true },
    { key: 'recordingFailedCommand', requiresRestart: true },
    { key: 'encodingFinishCommand', requiresRestart: true },

    // --- 機能フラグ・付随設定 ---
    { key: 'featureFlags', requiresRestart: true },
    { key: 'updateChecker', requiresRestart: false },
    { key: 'seriesLlm', requiresRestart: false },
] as const;

export const CONFIG_OVERLAY_KEYS: ReadonlySet<string> = new Set(CONFIG_OVERLAY_FIELDS.map(x => x.key as string));

const RESTART_REQUIRED_KEYS: ReadonlySet<string> = new Set(
    CONFIG_OVERLAY_FIELDS.filter(x => x.requiresRestart === true).map(x => x.key as string),
);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && Array.isArray(value) === false;

/**
 * オーバーレイから編集を許可していないキーを取り除く。
 * 画面や API から知らないキーが紛れ込んでも config へ混ぜない
 * @param overlay: unknown
 * @return Record<string, unknown>
 */
export const sanitizeConfigOverlay = (overlay: unknown): Record<string, unknown> => {
    if (isPlainObject(overlay) === false) return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overlay)) {
        if (CONFIG_OVERLAY_KEYS.has(key) === false) continue;
        // undefined / null は「未設定に戻す」の意味なので落とし、config.yml の値を使わせる
        if (typeof value === 'undefined' || value === null) continue;
        result[key] = value;
    }
    return result;
};

/**
 * config.yml の値にオーバーレイを重ねる。
 * オブジェクトは再帰的にマージし、配列は丸ごと置き換える
 * (録画ディレクトリやエンコード設定は「一覧そのもの」を編集するため)
 * @param base: IConfigFile config.yml から読んだ値
 * @param overlay: unknown DB に保存された差分
 * @return IConfigFile 実効値
 */
export const mergeConfigOverlay = (base: IConfigFile, overlay: unknown): IConfigFile => {
    const sanitized = sanitizeConfigOverlay(overlay);
    if (Object.keys(sanitized).length === 0) return base;

    const result: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
    for (const [key, value] of Object.entries(sanitized)) {
        result[key] = isPlainObject(value) === true ? deepMerge(result[key], value) : value;
    }
    return result as unknown as IConfigFile;
};

const deepMerge = (base: unknown, overlay: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = isPlainObject(base) === true ? { ...base } : {};
    for (const [key, value] of Object.entries(overlay)) {
        if (typeof value === 'undefined' || value === null) {
            delete result[key];
            continue;
        }
        result[key] = isPlainObject(value) === true ? deepMerge(result[key], value) : value;
    }
    return result;
};

/**
 * 変更されたキーのうち、反映に再起動が必要なものを返す
 * @param keys: string[]
 * @return string[]
 */
export const configOverlayRequiresRestart = (keys: string[]): string[] => {
    if (Array.isArray(keys) === false) return [];
    return keys.filter(key => RESTART_REQUIRED_KEYS.has(key));
};

/**
 * config.yml とオーバーレイを比べ、実際に値が変わっているキーを返す
 * (再起動が必要かの判定を「送られてきたキー」ではなく「変わったキー」で行うため)
 * @param base: IConfigFile
 * @param overlay: unknown
 * @return string[]
 */
export const diffConfigOverlayKeys = (base: IConfigFile, overlay: unknown): string[] => {
    const sanitized = sanitizeConfigOverlay(overlay);
    const source = base as unknown as Record<string, unknown>;
    return Object.keys(sanitized).filter(key => JSON.stringify(source[key]) !== JSON.stringify(sanitized[key]));
};
