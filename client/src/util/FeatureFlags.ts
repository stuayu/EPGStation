import * as apid from '../../../api';

/**
 * サーバから配信される段階導入用の機能フラグを判定する共通ヘルパー
 * サーバ側の isFeatureEnabled (src/model/FeatureFlags.ts) と対になるクライアント実装
 * 新しく機能フラグを追加した場合もこのユーティリティを再利用すること
 * @param config: apid.Config | null (IServerConfigModel.getConfig() の戻り値)
 * @param key: keyof apid.FeatureFlags
 * @return boolean 未設定・config が null の場合は false (安全側)
 */
export function isFeatureEnabled(config: apid.Config | null, key: keyof apid.FeatureFlags): boolean {
    return config?.featureFlags?.[key] === true;
}
