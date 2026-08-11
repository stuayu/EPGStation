/**
 * EPG リアルタイム同期 (event stream の緊急更新を先行して DB へ反映する) の設定解決。
 *
 * config.yml の epgRealtime は全項目が省略可能なため、
 * 既定値の穴埋めと不正値の丸めをここに集約する
 * (config はホットリロードされるので、実行時に毎回解決する)。
 */
import IConfigFile from '../IConfigFile';
import { isFeatureEnabled } from '../FeatureFlags';

export interface ResolvedEPGRealtimeConfig {
    // 機能が有効か (featureFlags.epgRealtimeSync)
    enabled: boolean;
    // 緊急イベント受信からフラッシュまでの待ち時間 (ms)。連続受信を 1 回の DB 更新にまとめる
    debounceMs: number;
    // 先行フラッシュ同士の最小間隔 (ms)
    minIntervalMs: number;
    // この時間内に始まる番組の更新を即時反映の対象とする (ms)
    urgentWindowMs: number;
}

// 既定値
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_MIN_INTERVAL_MS = 500;
const DEFAULT_URGENT_WINDOW_MINUTES = 180;

// 上限 (設定ミスで極端な値が入っても壊れないようにする)
const MAX_DEBOUNCE_MS = 60 * 1000;
const MAX_MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_URGENT_WINDOW_MINUTES = 24 * 60;

/**
 * 数値設定を既定値・範囲で丸める
 * @param value: unknown
 * @param defaultValue: number
 * @param max: number
 * @return number
 */
const clampNumber = (value: unknown, defaultValue: number, max: number): number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false || value < 0) {
        return defaultValue;
    }

    return Math.min(value, max);
};

/**
 * EPG リアルタイム同期の設定を解決する
 * @param config: IConfigFile
 * @return ResolvedEPGRealtimeConfig
 */
export const resolveEPGRealtimeConfig = (config: IConfigFile): ResolvedEPGRealtimeConfig => {
    const realtime = config.epgRealtime;

    return {
        enabled: isFeatureEnabled(config, 'epgRealtimeSync'),
        debounceMs: clampNumber(realtime?.debounceMs, DEFAULT_DEBOUNCE_MS, MAX_DEBOUNCE_MS),
        minIntervalMs: clampNumber(realtime?.minIntervalMs, DEFAULT_MIN_INTERVAL_MS, MAX_MIN_INTERVAL_MS),
        urgentWindowMs:
            clampNumber(realtime?.urgentWindowMinutes, DEFAULT_URGENT_WINDOW_MINUTES, MAX_URGENT_WINDOW_MINUTES) *
            60 *
            1000,
    };
};
