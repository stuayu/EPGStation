/** web-bml の receiverinfo NVRAM と同じ Base64 / byte 列形式を扱う。 */
/** receiverinfo NVRAM の byte 列を Base64 に変換する。
 * @param value byte 列として保存する文字列
 * @param byteLength 必要な byte 数
 * @return Base64 文字列
 */
export const encodeReceiverInfoValue = (value: string, byteLength: number): string => {
    const bytes = Array.from(value, char => char.charCodeAt(0));
    if (bytes.length !== byteLength || bytes.some(byte => byte < 0 || byte > 255))
        throw new Error(`値は ${byteLength} byte 必要`);
    return btoa(String.fromCharCode(...bytes));
};

/** Base64 の receiverinfo NVRAM 値を byte 列へ戻す。
 * @param encoded 保存値
 * @param byteLength 必要な byte 数
 * @param fallback 保存値が空の場合の値
 * @return 復元した文字列
 */
export const decodeReceiverInfoValue = (encoded: string | null, byteLength: number, fallback: string): string => {
    if (encoded === null || encoded.length === 0) return fallback;
    const decoded = atob(encoded);
    const bytes = Array.from(decoded, char => char.charCodeAt(0)).slice(0, byteLength);
    return Array.from(bytes, byte => String.fromCharCode(byte))
        .join('')
        .padEnd(byteLength, '\0');
};

export const receiverInfoStorageKeys = {
    zipcode: 'nvram_prefix=receiverinfo%2Fzipcode',
    prefecture: 'nvram_prefix=receiverinfo%2Fprefecture',
    regioncode: 'nvram_prefix=receiverinfo%2Fregioncode',
} as const;
