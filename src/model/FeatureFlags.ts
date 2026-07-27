import IConfigFile, { FEATURE_FLAG_KEYS, FeatureFlagKey, FeatureFlags } from './IConfigFile';

const ENABLED_FLAGS: Readonly<Record<FeatureFlagKey, boolean>> = Object.freeze(
    Object.fromEntries(FEATURE_FLAG_KEYS.map(key => [key, true])) as Record<FeatureFlagKey, boolean>,
);

/**
 * 機能フラグを解決する。
 * **未指定の機能は有効として扱う**。無効化したい場合のみ config.yml で明示的に false を書く
 * (フラグ付きの機能が出そろって既定動作になったため、opt-in から opt-out へ切り替えた)。
 * boolean 以外の値も「未指定」とみなして有効扱いにする
 */
export function resolveFeatureFlags(flags?: FeatureFlags): Readonly<Record<FeatureFlagKey, boolean>> {
    if (typeof flags === 'undefined') {
        return ENABLED_FLAGS;
    }

    return Object.freeze(
        Object.fromEntries(FEATURE_FLAG_KEYS.map(key => [key, flags[key] !== false])) as Record<
            FeatureFlagKey,
            boolean
        >,
    );
}

export function isFeatureEnabled(config: Pick<IConfigFile, 'featureFlags'>, key: FeatureFlagKey): boolean {
    return config.featureFlags?.[key] !== false;
}
