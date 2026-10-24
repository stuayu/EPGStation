export interface RecordingGapAttempt {
    firstDataAt?: number | null;
    endedAt?: number | null;
    closeReason?: string | null;
}

export interface RecordingGap {
    startAt: number;
    endAt?: number;
    reason: string;
}

/** TS を受け取った attempt の後にできた gap だけを返す。 */
export function deriveRecordingGaps(attempts: RecordingGapAttempt[]): RecordingGap[] {
    const gaps: RecordingGap[] = [];
    let lastDataAttempt: RecordingGapAttempt | undefined;
    let hasTrailingRetry = false;
    for (const attempt of attempts) {
        if (typeof attempt.firstDataAt === 'number') {
            if (lastDataAttempt && typeof lastDataAttempt.endedAt === 'number') {
                gaps.push({
                    startAt: lastDataAttempt.endedAt,
                    endAt: attempt.firstDataAt,
                    reason: lastDataAttempt.closeReason ?? 'unknown',
                });
            }
            lastDataAttempt = attempt;
            hasTrailingRetry = false;
        } else if (lastDataAttempt !== undefined) {
            hasTrailingRetry = true;
        }
    }
    if (hasTrailingRetry && lastDataAttempt && typeof lastDataAttempt.endedAt === 'number') {
        gaps.push({ startAt: lastDataAttempt.endedAt, reason: lastDataAttempt.closeReason ?? 'unknown' });
    }
    return gaps;
}

/** 再開時の transport gap 数を attempt 履歴から復元する。 */
export function countRecordingGaps(attempts: RecordingGapAttempt[]): number {
    return deriveRecordingGaps(attempts).filter(gap => gap.endAt !== undefined).length;
}
