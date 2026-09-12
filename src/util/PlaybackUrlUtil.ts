/**
 * 再生元として利用できる URL か判定する。
 * DPlayer / mpegts.js が生成する blob URL は、次の配信元 URL として再利用できない。
 * @param value: unknown 候補 URL
 * @return boolean 空でなく内部 blob URL でもなければ true
 */
export const isUsablePlaybackUrl = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && /^blob:/i.test(value.trim()) === false;

/**
 * 再生 URL 候補から最初に利用できる URL を返す。
 * @param candidates: unknown[] URL 候補 (優先順)
 * @return string | null 有効な候補が無ければ null
 */
export const findPlaybackUrl = (...candidates: unknown[]): string | null => {
    for (const candidate of candidates) {
        if (isUsablePlaybackUrl(candidate)) return candidate.trim();
    }

    return null;
};

/**
 * 再生 URL が空でないことを保証する。
 * @param value: unknown URL
 * @param context: string 呼び出し元
 * @return string 検証済み URL
 */
export const requirePlaybackUrl = (value: unknown, context: string): string => {
    const url = findPlaybackUrl(value);
    if (url === null) {
        throw new Error(`${context}: playback URL is empty`);
    }

    return url;
};
