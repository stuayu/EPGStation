/** 一覧件数が減った後も存在する最後のページへ収める。 */
export function resolveSafePageOffset(offset: number, limit: number, total: number): number {
    return total <= 0 ? 0 : Math.min(offset, Math.floor((total - 1) / limit) * limit);
}

/** サーバ件数に合わせて Series 一覧の URL page query を正規化する。 */
export function buildSafePageQuery<T extends object>(query: T, offset: number, limit: number): T {
    const result = { ...query } as Record<string, unknown>;
    const page = Math.floor(offset / limit) + 1;
    if (page <= 1) delete result.page;
    else result.page = String(page);
    return result as T;
}
