/**
 * 録画ファイルの再生位置に対応する BML の現在時刻を返す。
 * @param startAt 録画ファイル先頭の放送時刻 (UNIX ms)
 * @param positionSeconds 再生位置 (秒)
 * @return number | null
 */
export function resolveDataBroadcastingTime(startAt: number | null, positionSeconds: number): number | null {
    if (startAt === null || Number.isFinite(startAt) === false || Number.isFinite(positionSeconds) === false)
        return null;
    return Math.round(startAt + Math.max(0, positionSeconds) * 1000);
}
