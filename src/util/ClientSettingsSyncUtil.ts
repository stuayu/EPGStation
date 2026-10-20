/** ストレージ値から許可された設定だけを抽出する */
export const extractSyncableSettings = (
    values: Record<string, Record<string, unknown>>,
    allowList: Record<string, readonly string[]>,
): Record<string, Record<string, unknown>> =>
    Object.fromEntries(
        Object.entries(allowList).map(([storageKey, keys]) => [
            storageKey,
            Object.fromEntries(
                keys
                    .filter(key => Object.hasOwn(values[storageKey] ?? {}, key))
                    .map(key => [key, values[storageKey][key]]),
            ),
        ]),
    );

/** サーバー値を許可キーだけに適用し、端末固有値を残す */
export const mergeSyncableSettings = (
    currentValues: Record<string, Record<string, unknown>>,
    remoteValues: Record<string, Record<string, unknown>>,
    allowList: Record<string, readonly string[]>,
): Record<string, Record<string, unknown>> => {
    const merged = { ...currentValues };
    for (const [storageKey, keys] of Object.entries(allowList)) {
        const current = { ...(currentValues[storageKey] ?? {}) };
        const remote = remoteValues[storageKey] ?? {};
        for (const key of keys) if (Object.hasOwn(remote, key)) current[key] = remote[key];
        merged[storageKey] = current;
    }
    return merged;
};
