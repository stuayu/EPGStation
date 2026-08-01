/**
 * EIT[p/f] (現在放送中 / 次の番組) の更新検出。
 *
 * Mirakurun の event stream には EPG 全体の更新が流れてくるが、
 * 「今まさに見ている番組が変わった」ことを画面へ即時反映したいのは
 * 現在放送中とその次の番組 (EIT[p/f] 相当) だけである。
 * 10 秒周期の短サイクル保存のたびに全画面を再取得させないよう、
 * ここで対象チャンネルだけを絞り込む。
 * 放送時間未定 (ARIB の duration = 0xFFFFFF、Mirakurun では 1) の番組は
 * 終了時刻が分からないため、始まっていれば放送中として扱う
 */
import { isDurationUndefined } from '../../util/ProgramDuration';

export interface OnAirCandidate {
    // 放送局 (networkId * 100000 + serviceId で作られる id)
    channelId: number;
    // 開始時刻 (UnixtimeMS)
    startAt: number;
    // 番組長 (ms)。放送時間未定の場合は 1 が入る (ARIB の 0xFFFFFF)
    duration: number;
}

export interface DetectOnAirOption {
    // 現在時刻 (UnixtimeMS)
    now: number;
    // 「次の番組」とみなす先読み時間 (ms)。既定 10 分
    followingWindowMs?: number;
}

// EIT[p/f] の f (following) として扱う先読み時間
const DEFAULT_FOLLOWING_WINDOW_MS = 10 * 60 * 1000;

// EIT[p/f] のどちらに相当するか
export type OnAirSection = 'present' | 'following';

export interface OnAirDetectResult<T extends OnAirCandidate> {
    program: T;
    section: OnAirSection;
}

/**
 * 更新された番組のうち、現在放送中 (present) か直後に始まる (following) ものを
 * 区分付きで返す。ログ出力で「どちらの更新なのか」を示すために使う
 * @param programs: T[] 追加・更新された番組
 * @param option: DetectOnAirOption
 * @return OnAirDetectResult<T>[] 入力順を保った検出結果
 */
export const detectOnAirPrograms = <T extends OnAirCandidate>(
    programs: T[],
    option: DetectOnAirOption,
): OnAirDetectResult<T>[] => {
    if (Array.isArray(programs) === false || programs.length === 0) return [];
    const now = option.now;
    const window = option.followingWindowMs ?? DEFAULT_FOLLOWING_WINDOW_MS;

    const results: OnAirDetectResult<T>[] = [];
    for (const program of programs) {
        if (typeof program?.channelId !== 'number') continue;
        if (typeof program.startAt !== 'number') continue;
        // 先読み時間より先に始まる番組は EPG の通常更新に任せる
        if (program.startAt > now + window) continue;
        // 放送時間未定 (duration が 1) の番組は終了時刻が分からないため、
        // 始まっていれば放送中とみなす (暫定の終了時刻で早々に切り捨てない)
        if (isDurationUndefined(program.duration) === true) {
            results.push({ program: program, section: program.startAt <= now ? 'present' : 'following' });
            continue;
        }
        // すでに終わった番組は p/f のどちらでもない
        if (program.startAt + program.duration <= now) continue;
        results.push({ program: program, section: program.startAt <= now ? 'present' : 'following' });
    }

    return results;
};

/**
 * 更新された番組のうち、現在放送中 (present) か直後に始まる (following) ものの
 * 放送局 id を重複なしで返す
 * @param programs: OnAirCandidate[] 追加・更新された番組
 * @param option: DetectOnAirOption
 * @return number[] 対象の channelId (昇順)
 */
export const detectOnAirChannelIds = (programs: OnAirCandidate[], option: DetectOnAirOption): number[] => {
    const channelIds = new Set<number>();
    for (const result of detectOnAirPrograms(programs, option)) {
        channelIds.add(result.program.channelId);
    }

    return [...channelIds].sort((a, b) => a - b);
};
