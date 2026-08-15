/**
 * Amatsukaze 連携設定の解決。
 *
 * config.yml の amatsukaze は全項目が省略可能なため、既定値の穴埋めと不正値の丸めを
 * ここへ集約する (config はホットリロードされるので、実行時に毎回解決する)。
 */
import IConfigFile, { AmatsukazePathMapping } from '../IConfigFile';

export interface ResolvedAmatsukazeConfig {
    host: string;
    port: number;
    addTaskPath: string | null;
    amatsukazeRoot: string | null;
    monoPath: string | null;
    profile: string | null;
    priority: number;
    noMove: boolean;
    connectTimeoutMs: number;
    // 0 なら打ち切らない
    taskTimeoutMs: number;
    pathMappings: AmatsukazePathMapping[];
}

// 既定値
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 32768;
const DEFAULT_PRIORITY = 3;
const DEFAULT_CONNECT_TIMEOUT_MS = 60 * 1000;

// 上限 (設定ミスで極端な値が入っても壊れないようにする)
const MAX_CONNECT_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 5;

/**
 * 数値設定を既定値・範囲で丸める
 * @param value: unknown
 * @param defaultValue: number
 * @param min: number
 * @param max: number
 * @return number
 */
const clampNumber = (value: unknown, defaultValue: number, min: number, max: number): number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false) {
        return defaultValue;
    }

    return Math.min(Math.max(value, min), max);
};

/**
 * 空文字を null として扱いつつ文字列設定を取り出す
 * @param value: unknown
 * @return string | null
 */
const toStringOrNull = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();

    return trimmed.length === 0 ? null : trimmed;
};

/**
 * Amatsukaze 連携設定を解決する
 * @param config: IConfigFile
 * @return ResolvedAmatsukazeConfig
 */
export const resolveAmatsukazeConfig = (config: IConfigFile): ResolvedAmatsukazeConfig => {
    const amatsukaze = config.amatsukaze;

    const pathMappings: AmatsukazePathMapping[] = Array.isArray(amatsukaze?.pathMappings)
        ? amatsukaze.pathMappings.filter(
              mapping =>
                  typeof mapping?.local === 'string' &&
                  mapping.local.length > 0 &&
                  typeof mapping?.remote === 'string' &&
                  mapping.remote.length > 0,
          )
        : [];

    return {
        host: toStringOrNull(amatsukaze?.host) ?? DEFAULT_HOST,
        port: clampNumber(amatsukaze?.port, DEFAULT_PORT, 1, 65535),
        addTaskPath: toStringOrNull(amatsukaze?.addTaskPath),
        amatsukazeRoot: toStringOrNull(amatsukaze?.amatsukazeRoot),
        monoPath: toStringOrNull(amatsukaze?.monoPath),
        profile: toStringOrNull(amatsukaze?.profile),
        priority: clampNumber(amatsukaze?.priority, DEFAULT_PRIORITY, MIN_PRIORITY, MAX_PRIORITY),
        noMove: amatsukaze?.noMove !== false,
        connectTimeoutMs: clampNumber(
            amatsukaze?.connectTimeoutMs,
            DEFAULT_CONNECT_TIMEOUT_MS,
            1000,
            MAX_CONNECT_TIMEOUT_MS,
        ),
        taskTimeoutMs: clampNumber(amatsukaze?.taskTimeoutMs, 0, 0, Number.MAX_SAFE_INTEGER),
        pathMappings: pathMappings,
    };
};

/**
 * EPGStation から見たパスを Amatsukaze から見たパスへ変換する
 * @param filePath: string
 * @param mappings: AmatsukazePathMapping[]
 * @return string 一致する規則が無ければ元のパスをそのまま返す
 */
export const toRemotePath = (filePath: string, mappings: AmatsukazePathMapping[]): string => {
    for (const mapping of mappings) {
        if (filePath.startsWith(mapping.local) === true) {
            return mapping.remote + filePath.slice(mapping.local.length);
        }
    }

    return filePath;
};

/**
 * Amatsukaze から見たパスを EPGStation から見たパスへ戻す
 * @param filePath: string
 * @param mappings: AmatsukazePathMapping[]
 * @return string 一致する規則が無ければ元のパスをそのまま返す
 */
export const toLocalPath = (filePath: string, mappings: AmatsukazePathMapping[]): string => {
    for (const mapping of mappings) {
        if (filePath.startsWith(mapping.remote) === true) {
            return mapping.local + filePath.slice(mapping.remote.length);
        }
    }

    return filePath;
};

/**
 * 2 つのパスが同じファイルを指しているとみなせるか。
 * Amatsukaze (Windows) と EPGStation でパス区切り・大文字小文字が食い違うことがあるため、
 * 区切りを揃えて小文字化した上で比較する
 * @param a: string
 * @param b: string
 * @return boolean
 */
export const isSameFilePath = (a: string, b: string): boolean => {
    const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

    return normalize(a) === normalize(b);
};
