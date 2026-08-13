/**
 * 番組情報の更新通知の組み立て。
 *
 * EIT[p/f] 相当の更新 (ON_AIR_PROGRAM_UPDATED) は「現在放送中 / 直後に始まる番組」だけを
 * 対象にしているため、前番組の延長で数時間先までずれた場合や、
 * 先の時間帯へ特別番組が差し込まれた場合は番組表へ即時に反映されない。
 * ここでは **変更のあった番組の時間帯そのもの** を通知に載せ、
 * 番組表が「今表示している時間帯と重なるときだけ」取り直せるようにする。
 *
 * 併せて、更新・削除された番組 id も載せる (予約の追従に使う)。
 * 番組 id が多すぎる場合は載せず、周期的な予約全体更新に任せる
 * (件数の多いときは個別追従より全体更新のほうが安い)。
 */
import * as mapid from '../../../node_modules/mirakurun/api';
import { resolveEndAt } from '../../util/ProgramDuration';

export interface ProgramUpdateNotice {
    // 更新・削除された番組 id (予約の追従用)。多すぎる場合は空になる
    programIds: mapid.ProgramId[];
    // 変更のあった放送局 id (番組表の絞り込み用)
    channelIds: number[];
    // 変更のあった番組の時間帯 (UnixtimeMS)。対象が無い場合は null
    startAt: number | null;
    endAt: number | null;
}

/**
 * 削除された番組の放送局・時間帯 (DB から削除前に引いたもの)。
 * これが無いと「削除だけの更新」が放送局・時間帯の分からない通知になり、
 * 番組表・視聴画面が毎回取り直す羽目になる
 */
export interface DeletedProgramRange {
    channelId: number;
    startAt: number;
    endAt: number;
}

export interface BuildProgramUpdateNoticeOption {
    // 追加・更新された番組
    changed: mapid.Program[];
    // 削除された番組 id
    deleted: mapid.ProgramId[];
    // 削除された番組の放送局・時間帯 (引けなかった分は省略してよい)
    deletedRanges?: DeletedProgramRange[];
    // 番組から放送局 id を引く
    getChannelId: (program: mapid.Program) => number | null;
    // 通知に載せる番組 id の上限 (超えた場合は programIds を空にする)
    programIdLimit: number;
}

/**
 * 番組情報の更新通知を組み立てる
 * @param option: BuildProgramUpdateNoticeOption
 * @return ProgramUpdateNotice
 */
export const buildProgramUpdateNotice = (option: BuildProgramUpdateNoticeOption): ProgramUpdateNotice => {
    const programIds: mapid.ProgramId[] = [];
    const channelIds = new Set<number>();
    let startAt: number | null = null;
    let endAt: number | null = null;

    for (const program of option.changed) {
        if (typeof program?.id === 'number') {
            programIds.push(program.id);
        }
        if (typeof program?.startAt !== 'number') {
            continue;
        }

        const channelId = option.getChannelId(program);
        if (channelId !== null && channelId !== 0) {
            channelIds.add(channelId);
        }

        // 放送時間未定の番組は暫定の終了時刻で範囲に含める
        const programEndAt = resolveEndAt(program.startAt, program.duration);
        startAt = startAt === null ? program.startAt : Math.min(startAt, program.startAt);
        endAt = endAt === null ? programEndAt : Math.max(endAt, programEndAt);
    }

    for (const id of option.deleted) {
        if (typeof id === 'number') {
            programIds.push(id);
        }
    }

    // 削除された番組は DB から引いた放送局・時間帯を使う。
    // 引けなかった (既に消えていた) 分は範囲不明のままになる
    for (const range of option.deletedRanges ?? []) {
        if (typeof range?.startAt !== 'number' || typeof range.endAt !== 'number') {
            continue;
        }
        if (typeof range.channelId === 'number' && range.channelId !== 0) {
            channelIds.add(range.channelId);
        }
        startAt = startAt === null ? range.startAt : Math.min(startAt, range.startAt);
        endAt = endAt === null ? range.endAt : Math.max(endAt, range.endAt);
    }

    return {
        programIds: programIds.length > option.programIdLimit ? [] : programIds,
        channelIds: [...channelIds].sort((a, b) => a - b),
        startAt: startAt,
        endAt: endAt,
    };
};

/**
 * 通知すべき内容が含まれているか
 * @param notice: ProgramUpdateNotice
 * @return boolean
 */
export const hasProgramUpdateNotice = (notice: ProgramUpdateNotice): boolean => {
    return notice.programIds.length > 0 || notice.channelIds.length > 0;
};
