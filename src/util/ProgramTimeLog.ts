/**
 * 番組時刻をログへ書き出すための整形。
 *
 * EPG 追従 (EIT[p/f] による開始・終了時刻の変更) を後から追えるようにするため、
 * 「変更前 -> 変更後」を 1 行で読める形にそろえる。
 * 放送時間未定 (ARIB の duration = 0xFFFFFF、Mirakurun では 1) は
 * 終了時刻が「暫定値」であることが分かるように明示する
 */
import DateUtil from './DateUtil';
import { isDurationUndefined } from './ProgramDuration';

/**
 * ログ用に時刻を整形する
 * @param time: number | null | undefined UnixtimeMS
 * @return string
 */
export const formatLogTime = (time: number | null | undefined): string => {
    if (typeof time !== 'number' || Number.isFinite(time) === false) {
        return 'unknown';
    }

    return DateUtil.format(new Date(time), 'yyyy/MM/dd hh:mm:ss');
};

/**
 * 変更前後の時刻を 1 つの文字列にする。
 * 変わっていない場合は差分を出さずそのまま表示する
 * @param oldTime: number | null | undefined 変更前の UnixtimeMS (未知なら null)
 * @param newTime: number | null | undefined 変更後の UnixtimeMS
 * @return string
 */
export const formatTimeChange = (oldTime: number | null | undefined, newTime: number | null | undefined): string => {
    const newStr = formatLogTime(newTime);
    if (typeof oldTime !== 'number' || Number.isFinite(oldTime) === false) {
        return newStr;
    }
    if (oldTime === newTime) {
        return `${newStr} (no change)`;
    }

    const diffSec = Math.round(((newTime as number) - oldTime) / 1000);
    const sign = diffSec >= 0 ? '+' : '-';

    return `${formatLogTime(oldTime)} -> ${newStr} (${sign}${Math.abs(diffSec)}s)`;
};

/**
 * 番組長をログ用に整形する。放送時間未定は明示する
 * @param duration: number | null | undefined 番組長 (ms)
 * @return string
 */
export const formatLogDuration = (duration: number | null | undefined): string => {
    if (isDurationUndefined(duration) === true) {
        return 'undefined (pending)';
    }

    return `${Math.round((duration as number) / 1000)}s`;
};

/**
 * 放送時間未定かどうかの変化を表す。変化がなければ null を返す
 * @param oldDuration: number | null | undefined 変更前の番組長 (ms)。未知なら null
 * @param newDuration: number | null | undefined 変更後の番組長 (ms)
 * @return string | null
 */
export const formatDurationUndefinedChange = (
    oldDuration: number | null | undefined,
    newDuration: number | null | undefined,
): string | null => {
    const isNewUndefined = isDurationUndefined(newDuration);
    if (typeof oldDuration !== 'number' || Number.isFinite(oldDuration) === false) {
        return isNewUndefined === true ? 'end time is pending' : null;
    }

    const isOldUndefined = isDurationUndefined(oldDuration);
    if (isOldUndefined === isNewUndefined) {
        return isNewUndefined === true ? 'end time is still pending' : null;
    }

    return isNewUndefined === true ? 'end time became pending' : 'end time has been fixed';
};
