/**
 * event stream から受け取った番組更新イベントの緊急度判定。
 *
 * EPG の更新は「10 秒周期のバッチ + epgUpdateIntervalTime 周期の全件更新」で
 * DB へ反映されるため、災害時の特別番組の割り込みや前番組の延長による時刻変更が
 * 最大で epgUpdateIntervalTime (既定 10 分) 遅れて反映されることがある。
 *
 * そこで受信したイベントを「即時反映すべきもの (immediate)」と
 * 「従来どおり周期反映でよいもの (normal)」に分け、immediate を含む場合だけ
 * 短いデバウンスで先行フラッシュする。判定は queue へ積む時点で行うため
 * **DB 参照を伴わない同期処理だけで完結させる** 必要がある
 * (「DB の現在値と時刻が変わったか」は判定できないので、
 *  代わりに「近い時間帯の番組の更新か」で拾う)。
 */
import * as mapid from '../../../node_modules/mirakurun/api';
import { isDurationUndefined } from '../../util/ProgramDuration';
import { ProgramBaseEvent, RedefineProgram, RemoveProgram, UpdateEvent } from './IEPGUpdateManageModel';

export type ProgramUpdatePriority = 'immediate' | 'normal';

export interface ProgramUpdatePriorityOption {
    // 現在時刻 (UnixtimeMS)
    now: number;
    // この時間内に始まる番組の更新は即時反映の対象とする (ms)
    urgentWindowMs: number;
    // 予約済みの番組か判定する (指定した場合、放送時刻に関わらず即時反映の対象になる)
    isReservedProgramId?: (programId: mapid.ProgramId) => boolean;
}

/**
 * イベントが対象としている番組 id を取り出す。
 * redefine は付け替え元 (from) を対象とする
 * @param event: ProgramBaseEvent
 * @return mapid.ProgramId | null 取り出せない場合は null
 */
export const getEventProgramId = (event: ProgramBaseEvent): mapid.ProgramId | null => {
    if (typeof event?.data !== 'object' || event.data === null) {
        return null;
    }

    const id = (<RemoveProgram>event.data).id;
    if (typeof id === 'number') {
        return id;
    }

    const from = (<RedefineProgram>event.data).from;

    return typeof from === 'number' ? from : null;
};

/**
 * 番組更新イベントの緊急度を判定する。
 *
 * 即時反映の対象は次のいずれか。
 * - remove / redefine: 番組が消滅・付け替えられた (特別番組の割り込みで飛んだ場合を含む)
 * - 放送時間未定 (ARIB の duration = 0xFFFFFF、Mirakurun では 1): 延長・特番編成の典型
 * - urgentWindowMs 以内に始まる (または既に始まっている) 番組の更新
 * - 予約済みの番組の更新 (放送時刻が先でも録画に直結するため)
 * @param event: ProgramBaseEvent
 * @param option: ProgramUpdatePriorityOption
 * @return ProgramUpdatePriority
 */
export const classifyProgramEvent = (
    event: ProgramBaseEvent,
    option: ProgramUpdatePriorityOption,
): ProgramUpdatePriority => {
    if (typeof event?.type !== 'string') {
        return 'normal';
    }

    // 番組の消滅・付け替えは即時に反映する
    if (event.type !== 'create' && event.type !== 'update') {
        return 'immediate';
    }

    const program = (<UpdateEvent>event).data;
    if (typeof program !== 'object' || program === null) {
        return 'normal';
    }

    // 予約済みの番組は放送時刻に関わらず即時反映する
    if (typeof program.id === 'number' && option.isReservedProgramId?.(program.id) === true) {
        return 'immediate';
    }

    if (typeof program.startAt !== 'number') {
        return 'normal';
    }

    // 放送時間未定は終了時刻が読めないため、時間帯に関わらず即時反映する
    if (isDurationUndefined(program.duration) === true) {
        return 'immediate';
    }

    // 既に終わった番組の更新は急がない
    if (program.startAt + program.duration <= option.now) {
        return 'normal';
    }

    return program.startAt <= option.now + option.urgentWindowMs ? 'immediate' : 'normal';
};

/**
 * キューを「即時反映すべきイベント」と「残すイベント」に分ける。
 *
 * 同じ番組に対するイベントは時系列順に処理しないと古い内容で上書きされてしまうため、
 * **immediate と判定された番組 id に属するイベントはすべて** 先行フラッシュ側へ移す
 * (後続の update だけ残して先に古い create を書く、といった追い越しを防ぐ)。
 * どちらの配列も元の順序を保つ
 * @param queue: ProgramBaseEvent[] 判定対象のキュー
 * @param option: ProgramUpdatePriorityOption
 * @return { urgent: ProgramBaseEvent[]; rest: ProgramBaseEvent[] }
 */
export const splitUrgentProgramEvents = (
    queue: ProgramBaseEvent[],
    option: ProgramUpdatePriorityOption,
): { urgent: ProgramBaseEvent[]; rest: ProgramBaseEvent[] } => {
    if (Array.isArray(queue) === false || queue.length === 0) {
        return { urgent: [], rest: [] };
    }

    // 即時反映の対象となる番組 id を集める
    const urgentProgramIds = new Set<mapid.ProgramId>();
    for (const event of queue) {
        if (classifyProgramEvent(event, option) !== 'immediate') {
            continue;
        }
        const programId = getEventProgramId(event);
        if (programId !== null) {
            urgentProgramIds.add(programId);
        }
    }

    if (urgentProgramIds.size === 0) {
        return { urgent: [], rest: queue.slice() };
    }

    const urgent: ProgramBaseEvent[] = [];
    const rest: ProgramBaseEvent[] = [];
    for (const event of queue) {
        const programId = getEventProgramId(event);
        if (programId !== null && urgentProgramIds.has(programId) === true) {
            urgent.push(event);
        } else {
            rest.push(event);
        }
    }

    return { urgent: urgent, rest: rest };
};
