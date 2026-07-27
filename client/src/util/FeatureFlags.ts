import * as apid from '../../../api';

/**
 * サーバから配信される機能フラグを判定する共通ヘルパー
 * サーバ側の isFeatureEnabled (src/model/FeatureFlags.ts) と対になるクライアント実装。
 * サーバは resolveFeatureFlags() で全キーを解決済みの boolean にして配信するため、
 * 通常はそのまま読むだけでよい。未設定のキーは有効扱い (opt-out) とし、
 * 無効化は明示的な false でのみ行う
 * @param config: apid.Config | null (IServerConfigModel.getConfig() の戻り値)
 * @param key: keyof apid.FeatureFlags
 * @return boolean config が未取得 (null) の場合のみ false
 */
export function isFeatureEnabled(config: apid.Config | null, key: keyof apid.FeatureFlags): boolean {
    if (config === null || typeof config === 'undefined') return false;

    return config.featureFlags?.[key] !== false;
}
