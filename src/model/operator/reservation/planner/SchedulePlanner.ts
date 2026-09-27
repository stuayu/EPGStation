import * as apid from '../../../../../api';
import { RecordingTimingConfig } from '../../recording/RecordingTimingConfig';

export type ReservationConflictType =
    'NO_TUNER' | 'PRIORITY_PREEMPTED' | 'PARTIAL_HEAD' | 'PARTIAL_TAIL' | 'MARGIN_OVERLAP' | 'BACKEND_UNAVAILABLE';

export interface ReservationConflict {
    type: ReservationConflictType;
    affectedMs: number;
    conflictingReserveIds: number[];
}

export interface PlannedReservation {
    reserveId: number;
    tunerIndex: number | null;
    conflict: ReservationConflict | null;
    lostMs: number;
    reasons: string[];
}

export interface SchedulePlannerReservation {
    id: number;
    startAt: number;
    endAt: number;
    channel: string;
    channelType: string;
    allowEndLack?: boolean;
    isSkip?: boolean;
    isOverlap?: boolean;
    priority?: number;
}

export interface SchedulePlannerTuner {
    index: number;
    types: string[];
    isAvailable?: boolean;
}

export interface SchedulePlannerSession {
    reserveId: number;
    tunerIndex: number;
    started: boolean;
}

export interface SchedulePlannerInput {
    reservations: SchedulePlannerReservation[];
    tuners: SchedulePlannerTuner[];
    sessions?: SchedulePlannerSession[];
    timing: RecordingTimingConfig;
    previousPlan?: PlannedReservation[];
}

const ALLOW_END_LACK_MS = 15 * 1000;

/**
 * 時刻区間ごとにチャンネルグループを最大マッチングし、予約の割当と欠損を計画する。
 * @param input SchedulePlannerInput
 * @return PlannedReservation[]
 */
export const planSchedule = (input: SchedulePlannerInput): PlannedReservation[] => {
    const tuners = input.tuners.map(tuner => ({
        ...tuner,
        types: tuner.types.length === 0 ? [...SchedulePlanner.CHANNEL_TYPES] : tuner.types,
    }));
    const reasons = new Map<number, string[]>();
    for (const tuner of input.tuners) {
        if (tuner.types.length === 0) {
            for (const reserve of input.reservations) {
                addReason(reasons, reserve.id, `tuner:${tuner.index}:empty-types-treated-as-all`);
            }
        }
    }
    const activeSessions = new Map(
        (input.sessions ?? []).filter(session => session.started).map(session => [session.reserveId, session]),
    );
    const previous = new Map((input.previousPlan ?? []).map(plan => [plan.reserveId, plan.tunerIndex]));
    const candidates = input.reservations.filter(reserve => reserve.isSkip !== true && reserve.isOverlap !== true);
    const times = [
        ...new Set(
            candidates.flatMap(reserve => [
                reserve.startAt - input.timing.prepMs,
                reserve.startAt - input.timing.startMarginMs,
                reserve.startAt,
                reserve.endAt,
                reserve.endAt + input.timing.endMarginMs,
            ]),
        ),
    ].sort((a, b) => a - b);
    const lost = new Map<number, number>();
    const lostBounds = new Map<number, { startAt: number; endAt: number }>();
    const marginOverlap = new Map<number, number>();
    const tunerVotes = new Map<number, Map<number, number>>();
    const conflicting = new Map<number, Set<number>>();
    const failed = new Set<number>();

    for (let i = 0; i < times.length - 1; i++) {
        const start = times[i];
        const end = times[i + 1];
        if (end <= start) continue;
        const interval = end - start;
        const active = candidates.filter(
            reserve => reserve.startAt - input.timing.prepMs < end && reserve.endAt + input.timing.endMarginMs > start,
        );
        const groups = new Map<string, SchedulePlannerReservation[]>();
        for (const reserve of active) {
            const group = groups.get(reserve.channel) ?? [];
            group.push(reserve);
            groups.set(reserve.channel, group);
        }
        const ordered = [...groups.entries()]
            .map(([channel, reservations]) => ({
                channel,
                reservations: reservations.sort((a, b) => comparePriority(a, b)),
                priority: Math.min(...reservations.map(reserve => reserve.priority ?? reserve.id)),
            }))
            .sort((a, b) => a.priority - b.priority || a.channel.localeCompare(b.channel));
        const intervalGroups = [...ordered].sort((a, b) => {
            const aStarted = a.reservations.some(reserve => activeSessions.has(reserve.id));
            const bStarted = b.reservations.some(reserve => activeSessions.has(reserve.id));
            const aFailed = a.reservations.some(reserve => failed.has(reserve.id));
            const bFailed = b.reservations.some(reserve => failed.has(reserve.id));
            return (
                Number(bStarted) - Number(aStarted) ||
                Number(aFailed) - Number(bFailed) ||
                a.priority - b.priority ||
                a.channel.localeCompare(b.channel)
            );
        });
        const matching = new Map<string, number>();
        const tunerGroup = new Map<number, string>();
        const allowedTuners = (group: (typeof ordered)[number]): number[] => {
            const fixed = group.reservations
                .map(reserve => activeSessions.get(reserve.id))
                .find(session => session !== undefined);
            if (fixed !== undefined) return [fixed.tunerIndex];
            const available = tuners
                .filter(
                    tuner =>
                        tuner.isAvailable !== false &&
                        group.reservations.some(reserve => tuner.types.includes(reserve.channelType)),
                )
                .map(tuner => tuner.index);
            const oldIndex = group.reservations
                .map(reserve => previous.get(reserve.id))
                .find(index => index !== undefined && index !== null);
            return available.sort((a, b) => Number(b === oldIndex) - Number(a === oldIndex) || a - b);
        };
        const augment = (group: (typeof ordered)[number], visited: Set<number>): boolean => {
            for (const tunerIndex of allowedTuners(group)) {
                if (visited.has(tunerIndex)) continue;
                visited.add(tunerIndex);
                const existingChannel = tunerGroup.get(tunerIndex);
                if (
                    existingChannel === undefined ||
                    (intervalGroups.find(candidate => candidate.channel === existingChannel && candidate !== group) !==
                        undefined &&
                        augment(
                            intervalGroups.find(
                                candidate => candidate.channel === existingChannel && candidate !== group,
                            )!,
                            visited,
                        ))
                ) {
                    tunerGroup.set(tunerIndex, group.channel);
                    matching.set(group.channel, tunerIndex);
                    return true;
                }
            }
            return false;
        };
        // 先に高優先グループを確定し、未割当グループは以後の区間で下位を押し出さない。
        for (const group of intervalGroups) {
            const stillEligible = group.reservations;
            const filteredGroup = { ...group, reservations: stillEligible };
            const success = augment(filteredGroup, new Set());
            for (const reserve of stillEligible) {
                const actual = start >= reserve.startAt && end <= reserve.endAt;
                if (!success && actual) {
                    lost.set(reserve.id, (lost.get(reserve.id) ?? 0) + interval);
                    const bounds = lostBounds.get(reserve.id);
                    lostBounds.set(reserve.id, {
                        startAt: Math.min(bounds?.startAt ?? start, start),
                        endAt: Math.max(bounds?.endAt ?? end, end),
                    });
                    failed.add(reserve.id);
                    const others = [...intervalGroups]
                        .filter(other => other.channel !== group.channel && matching.has(other.channel))
                        .flatMap(other => other.reservations.map(item => item.id));
                    conflicting.set(reserve.id, new Set(others));
                    addReason(reasons, reserve.id, 'conflicted-reservation-excluded-from-later-intervals');
                } else if (!success && start < reserve.startAt) {
                    marginOverlap.set(reserve.id, (marginOverlap.get(reserve.id) ?? 0) + interval);
                    addReason(reasons, reserve.id, `margin-overlap:${interval}ms`);
                }
            }
        }
        for (const group of intervalGroups) {
            const tunerIndex = matching.get(group.channel);
            if (tunerIndex === undefined) continue;
            for (const reserve of group.reservations.filter(item => !failed.has(item.id))) {
                const counts = tunerVotes.get(reserve.id) ?? new Map<number, number>();
                counts.set(tunerIndex, (counts.get(tunerIndex) ?? 0) + interval);
                tunerVotes.set(reserve.id, counts);
            }
        }
    }

    const plans = input.reservations.map(reserve => {
        const lostMs = lost.get(reserve.id) ?? 0;
        const votes = tunerVotes.get(reserve.id);
        let tunerIndex: number | null = null;
        if (votes !== undefined && votes.size > 0)
            tunerIndex = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        const bounds = lostBounds.get(reserve.id);
        const hasHeadLoss = bounds?.startAt === reserve.startAt;
        const hasTailLoss = bounds?.endAt === reserve.endAt;
        const shortFullLoss = bounds !== undefined && bounds.endAt - bounds.startAt <= ALLOW_END_LACK_MS;
        const allowTail =
            reserve.allowEndLack === true &&
            (hasHeadLoss !== true || shortFullLoss) &&
            hasTailLoss === true &&
            lostMs <= ALLOW_END_LACK_MS;
        const marginOverlapMs = marginOverlap.get(reserve.id) ?? 0;
        const conflict: ReservationConflict | null =
            lostMs > 0 && allowTail === false
                ? {
                      type:
                          hasHeadLoss === true && hasTailLoss !== true
                              ? 'PARTIAL_HEAD'
                              : hasTailLoss === true && (hasHeadLoss !== true || shortFullLoss)
                                ? 'PARTIAL_TAIL'
                                : 'NO_TUNER',
                      affectedMs: lostMs,
                      conflictingReserveIds: [...(conflicting.get(reserve.id) ?? [])].sort((a, b) => a - b),
                  }
                : lostMs === 0 && marginOverlapMs > 0
                  ? { type: 'MARGIN_OVERLAP', affectedMs: marginOverlapMs, conflictingReserveIds: [] }
                  : null;
        if (allowTail && lostMs > 0) addReason(reasons, reserve.id, 'allowEndLack-accepted-tail-loss');
        const previousTuner = previous.get(reserve.id);
        if (previousTuner !== undefined && previousTuner !== tunerIndex)
            addReason(reasons, reserve.id, `previous-tuner:${previousTuner}-changed-to:${String(tunerIndex)}`);
        if (conflict !== null) addReason(reasons, reserve.id, `strict-conflict:${conflict.type}:${lostMs}ms`);
        return { reserveId: reserve.id, tunerIndex, conflict, lostMs, reasons: reasons.get(reserve.id) ?? [] };
    });
    return plans;
};

const comparePriority = (a: SchedulePlannerReservation, b: SchedulePlannerReservation): number =>
    (a.priority ?? a.id) - (b.priority ?? b.id) || a.id - b.id;
const addReason = (reasons: Map<number, string[]>, reserveId: number, reason: string): void => {
    const list = reasons.get(reserveId) ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons.set(reserveId, list);
};

namespace SchedulePlanner {
    export const CHANNEL_TYPES: apid.ChannelType[] = [
        'GR',
        'BS',
        'CS',
        'SKY',
        ...Array.from({ length: 40 }, (_, index) => `NW${index + 1}` as apid.ChannelType),
        'BS4K',
        'CS4K',
    ];
}

export default { planSchedule };
