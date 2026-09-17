/**
 * バイト数をオフライン保存画面と同じ単位で表示する。
 * @param bytes: number バイト数
 * @return string 整形済みの容量
 */
export const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
};
