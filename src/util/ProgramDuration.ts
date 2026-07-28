/**
 * 放送時間未定の番組の扱い。
 *
 * ARIB の EIT では放送時間が未定のとき duration に 0xFFFFFF が入り、
 * Mirakurun はこれを `duration: 1` (1ms) として返す
 * (実データでも NHK 系のニュース枠などで発生する)。
 * そのまま `endAt = startAt + duration` とすると開始 1ms 後に終了した扱いになり、
 * 放送中一覧・視聴画面の番組情報・EPG から即座に消えてしまう。
 * ここで「未定」を判定し、終了時刻には暫定値を入れる
 */

// duration がこの値以下なら「放送時間未定」とみなす (Mirakurun は 1 を返す)
const UNDEFINED_DURATION_THRESHOLD = 1;

// 終了時刻が未定の番組に与える暫定の長さ。
// 長すぎると番組表で他の番組を覆い隠し、短すぎるとすぐ放送終了扱いになるため中間を取る
export const UNDEFINED_DURATION_FALLBACK_MS = 3 * 60 * 60 * 1000;

/**
 * 放送時間が未定か
 * @param duration: number | undefined | null 番組長 (ms)
 * @return boolean
 */
export const isDurationUndefined = (duration: number | undefined | null): boolean => {
    if (typeof duration !== 'number' || Number.isFinite(duration) === false) return true;
    return duration <= UNDEFINED_DURATION_THRESHOLD;
};

/**
 * 終了時刻を求める。未定の場合は暫定値を返す
 * @param startAt: number 開始時刻 (UnixtimeMS)
 * @param duration: number | undefined | null 番組長 (ms)
 * @return number 終了時刻 (UnixtimeMS)
 */
export const resolveEndAt = (startAt: number, duration: number | undefined | null): number => {
    return startAt + (isDurationUndefined(duration) ? UNDEFINED_DURATION_FALLBACK_MS : (duration as number));
};

export interface ClampTarget {
    startAt: number;
    endAt: number;
    isDurationUndefined?: boolean;
}

/**
 * 放送時間未定の番組が持つ暫定の終了時刻を、同じ放送局の次の番組の開始時刻で切り詰める。
 * 番組表で次の番組に食い込んでレイアウトが崩れるのを防ぐ (次の番組が無ければ暫定値のまま)
 * @param programs: T[] 同一放送局の番組
 * @return T[] 開始時刻順に並べ替えたもの
 */
export const clampUndefinedDuration = <T extends ClampTarget>(programs: T[]): T[] => {
    const sorted = [...programs].sort((a, b) => a.startAt - b.startAt);
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].isDurationUndefined !== true) continue;
        const next = sorted[i + 1];
        if (typeof next === 'undefined') continue;
        if (next.startAt > sorted[i].startAt && next.startAt < sorted[i].endAt) {
            sorted[i] = { ...sorted[i], endAt: next.startAt };
        }
    }
    return sorted;
};
