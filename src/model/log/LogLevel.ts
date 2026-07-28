/**
 * ログレベル設定の正規化。
 * ログ設定ファイル (config/*LogConfig.yml) がベースで、
 * ここで扱う DB 側の値はその上に被せる差分として使う (§ ログレベルの GUI 変更)。
 * 未指定のカテゴリはファイルの設定をそのまま残す
 */

export const LOG_CATEGORIES = ['system', 'access', 'stream', 'encode'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

// log4js が受け付けるレベル。'off' で出力を止められる
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'mark', 'off'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogLevelSetting = Partial<Record<LogCategory, LogLevel>>;

const isLogLevel = (value: unknown): value is LogLevel =>
    typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);

/**
 * DB から読んだ値をログレベル設定として解釈する。
 * 未知のカテゴリ・不正なレベルは黙って捨てる (壊れた設定でログ出力自体を壊さないため)
 * @param value: unknown app_setting の logging 値
 * @return LogLevelSetting
 */
export const resolveLogLevels = (value: unknown): LogLevelSetting => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const levels = (value as { levels?: unknown }).levels;
    if (typeof levels !== 'object' || levels === null || Array.isArray(levels)) return {};

    const result: LogLevelSetting = {};
    for (const category of LOG_CATEGORIES) {
        const level = (levels as Record<string, unknown>)[category];
        if (isLogLevel(level)) result[category] = level;
    }
    return result;
};
