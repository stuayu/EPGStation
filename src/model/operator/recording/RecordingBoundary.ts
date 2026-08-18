/** EIT 境界による録画終了の純粋判定 */
export type RecordingEndReason = 'present-event-changed' | 'scheduled-end' | null;

export interface RecordingEndDecisionInput {
    targetEventId: number;
    presentEventId: number | null;
    targetConfirmed: boolean;
    now: number;
    endAt: number;
    endMarginMs: number;
}

/**
 * 開始後の一時的 EIT 欠落では終了せず、対象を確認した後の別 event または
 * 予約終了ハード期限だけを終了条件にする。
 */
export const decideRecordingEnd = (input: RecordingEndDecisionInput): RecordingEndReason => {
    if (input.now >= input.endAt + input.endMarginMs) return 'scheduled-end';
    if (input.targetConfirmed && input.presentEventId !== null && input.presentEventId !== input.targetEventId) {
        return 'present-event-changed';
    }
    return null;
};
