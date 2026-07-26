/**
 * ランタイム設定 (DB: app_setting) と config.yml の優先順位を統一的に解決するユーティリティ。
 * 優先順位は 常に DB > config.yml > ハードコードされた既定値 (§6.3)。
 * DB 上の値は AppSettingApiModel の JSON Schema 検証を経て保存されているため型は概ね正しいが、
 * 直接 DB を書き換えた場合などに備えて呼び出し側の型ガードは緩めに保つ
 */
export function resolveNumber(dbValue: unknown, configDefault: number | undefined, fallback: number): number {
    if (typeof dbValue === 'number' && Number.isFinite(dbValue)) return dbValue;
    if (typeof configDefault === 'number' && Number.isFinite(configDefault)) return configDefault;
    return fallback;
}

export function resolveBoolean(dbValue: unknown, configDefault: boolean | undefined, fallback: boolean): boolean {
    if (typeof dbValue === 'boolean') return dbValue;
    if (typeof configDefault === 'boolean') return configDefault;
    return fallback;
}
