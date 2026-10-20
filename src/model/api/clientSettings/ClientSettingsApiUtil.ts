export type ClientSettingsValidationError = 'InvalidClientSettings' | 'ClientSettingsTooLarge';

/** 設定オブジェクトと UTF-8 JSON サイズを検証する */
export const validateClientSettings = (settings: unknown): ClientSettingsValidationError | null => {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        return 'InvalidClientSettings';
    }
    return Buffer.byteLength(JSON.stringify(settings) ?? '', 'utf8') > 256 * 1024 ? 'ClientSettingsTooLarge' : null;
};
