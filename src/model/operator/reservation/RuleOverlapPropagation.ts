interface RuleOverlapReservation {
    ruleId: number | null;
    programId: number | null;
    isEventRelay: boolean;
    isTimeSpecified: boolean;
    isOverlap: boolean;
    isIgnoreOverlap: boolean;
}

/**
 * 別ルールの重複判定を番組指定予約へ波及できるか判定する。
 * @param target 波及先の予約
 * @param source 波及元の予約
 * @return 利用者による解除や手動・イベントリレー予約を除き、同じ番組の別ルールなら true
 */
export const shouldPropagateRuleOverlap = (target: RuleOverlapReservation, source: RuleOverlapReservation): boolean =>
    target.ruleId !== null &&
    source.ruleId !== null &&
    target.ruleId !== source.ruleId &&
    target.programId !== null &&
    target.programId === source.programId &&
    target.isEventRelay === false &&
    source.isEventRelay === false &&
    target.isTimeSpecified === false &&
    source.isTimeSpecified === false &&
    target.isIgnoreOverlap !== true &&
    source.isIgnoreOverlap !== true &&
    source.isOverlap === true;
