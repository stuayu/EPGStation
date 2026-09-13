import { resolveRecordedJikkyoTimestamp } from '../../../util/RecordedJikkyoSync';

/**
 * 録画ファイルの再生位置に対応する BML の現在時刻を返す。
 * 録画実況と同じく、録画ファイル先頭の放送時刻 + VirtualTimeline の絶対位置を使う。
 * @param startAt 録画ファイル先頭の放送時刻 (UNIX ms)
 * @param positionSeconds VirtualTimeline 上の絶対再生位置 (秒)
 * @return number | null
 */
export function resolveDataBroadcastingTime(
    startAt: number | null,
    positionSeconds: number | null | undefined,
): number | null {
    if (startAt === null || Number.isFinite(startAt) === false) return null;

    return resolveRecordedJikkyoTimestamp(startAt, positionSeconds);
}
