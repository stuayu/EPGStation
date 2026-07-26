import IConfigFile, { FEATURE_FLAG_KEYS, FeatureFlagKey, FeatureFlags } from './IConfigFile';

const DISABLED_FLAGS: Readonly<Record<FeatureFlagKey, boolean>> = Object.freeze(
    Object.fromEntries(FEATURE_FLAG_KEYS.map(key => [key, false])) as Record<FeatureFlagKey, boolean>,
);

/**
 * 段階導入用の機能フラグを解決する。
 * 未知・未指定・boolean 以外の値は安全側（無効）として扱う。
 */
export function resolveFeatureFlags(flags?: FeatureFlags): Readonly<Record<FeatureFlagKey, boolean>> {
    if (typeof flags === 'undefined') {
        return DISABLED_FLAGS;
    }

    return Object.freeze(
        Object.fromEntries(FEATURE_FLAG_KEYS.map(key => [key, flags[key] === true])) as Record<FeatureFlagKey, boolean>,
    );
}

export function isFeatureEnabled(config: Pick<IConfigFile, 'featureFlags'>, key: FeatureFlagKey): boolean {
    return config.featureFlags?.[key] === true;
}
