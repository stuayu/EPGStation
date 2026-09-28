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
    for (let i = 0; i + 1 < attempts.length; i++) {
        const current = attempts[i];
        if (typeof current.firstDataAt !== 'number' || typeof current.endedAt !== 'number') continue;
        const gap: RecordingGap = { startAt: current.endedAt, reason: current.closeReason ?? 'unknown' };
        const endAt = attempts[i + 1].firstDataAt;
        if (typeof endAt === 'number') gap.endAt = endAt;
        gaps.push(gap);
    }
    return gaps;
}

/** 再開時の transport gap 数を attempt 履歴から復元する。 */
export function countRecordingGaps(attempts: RecordingGapAttempt[]): number {
    return deriveRecordingGaps(attempts).filter(gap => gap.endAt !== undefined).length;
}
