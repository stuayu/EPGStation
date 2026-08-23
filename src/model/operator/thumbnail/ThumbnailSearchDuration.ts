export const DEFAULT_THUMBNAIL_SEARCH_DURATION = 1200;

/**
 * 動画尺と設定から候補探索範囲を解決する。
 * @param videoDuration 動画尺（秒）
 * @param configured 設定値。0 は全編、負値は 0 へ丸める
 * @return 先頭から探索する秒数
 */
export function resolveThumbnailSearchDuration(videoDuration: number, configured?: number): number {
    const safeVideoDuration = Number.isFinite(videoDuration) ? Math.max(0, videoDuration) : 0;
    const searchDuration = Number.isFinite(configured)
        ? Math.max(0, configured as number)
        : DEFAULT_THUMBNAIL_SEARCH_DURATION;
    return searchDuration === 0 ? safeVideoDuration : Math.min(safeVideoDuration, searchDuration);
}
