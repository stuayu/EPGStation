import Program from '../../db/entities/Program';
import { clampUndefinedDuration, isDurationUndefined, resolveEndAt } from '../../util/ProgramDuration';

/**
 * 放送中と直後の番組を放送局ごとに比較するための署名を作る。
 * @param programs: Program[] 放送中検索で得た番組
 * @param now: number 判定時刻 (UnixtimeMS)
 * @return Map<number, string> channelId ごとの番組署名
 */
export const createOnAirProgramSnapshot = (programs: Program[], now: number): Map<number, string> => {
    const programsByChannel = new Map<number, Program[]>();
    for (const program of programs) {
        const channelPrograms = programsByChannel.get(program.channelId) ?? [];
        channelPrograms.push(program);
        programsByChannel.set(program.channelId, channelPrograms);
    }

    const snapshot = new Map<number, string>();
    for (const [channelId, channelPrograms] of programsByChannel) {
        const clamped = clampUndefinedDuration(
            channelPrograms.map(program => ({
                ...program,
                endAt: resolveEndAt(program.startAt, program.duration),
                isDurationUndefined: isDurationUndefined(program.duration),
            })),
        );
        const currentAndFollowing = clamped.filter(program => program.endAt > now).slice(0, 2);
        snapshot.set(
            channelId,
            currentAndFollowing.map(program => `${program.id}:${program.startAt}:${program.endAt}`).join('|'),
        );
    }

    return snapshot;
};

/**
 * 全件更新の前後で放送中情報が変わった放送局を返す。
 * @param before: Map<number, string> 更新前の署名
 * @param after: Map<number, string> 更新後の署名
 * @return number[] 変更された channelId (昇順)
 */
export const findChangedOnAirChannels = (before: Map<number, string>, after: Map<number, string>): number[] => {
    const channelIds = new Set([...before.keys(), ...after.keys()]);

    return [...channelIds].filter(channelId => before.get(channelId) !== after.get(channelId)).sort((a, b) => a - b);
};
