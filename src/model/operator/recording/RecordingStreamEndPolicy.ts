export type RecordingStreamCloseReason =
    | 'scheduled-end'
    | 'boundary'
    | 'canceled'
    | 'tuner-handoff'
    | 'superseded'
    | 'obsolete'
    | 'teardown'
    | 'write-error'
    | 'reconnect-no-data'
    | null;

export type RecordingStreamEndDecision =
    'ignore' | 'scheduled-end' | 'boundary' | 'canceled' | 'tuner-handoff' | 'stream-ended' | 'failed' | 'reconnect';

export interface RecordingStreamEndPolicyInput {
    closeReason: RecordingStreamCloseReason;
    hasError: boolean;
    now: number;
    deadline: number;
    managedEnd: boolean;
    isCurrent: boolean;
    boundaryDecided: boolean;
    reconnectEnabled: boolean;
}

/** programId が無い、または service モードなら終了を録画側で管理する。 */
export const usesManagedEnd = (programId: number | null, programStreamMode: string): boolean =>
    programId === null || programStreamMode !== 'program';

/** 上流 close の理由と録画状態から、次の処理を純粋に決める。 */
export const decideRecordingStreamEnd = (input: RecordingStreamEndPolicyInput): RecordingStreamEndDecision => {
    if (!input.isCurrent) return 'ignore';
    if (
        input.closeReason === 'superseded' ||
        input.closeReason === 'obsolete' ||
        input.closeReason === 'teardown' ||
        input.closeReason === 'write-error'
    )
        return 'ignore';
    if (input.closeReason === 'scheduled-end') return 'scheduled-end';
    if (input.closeReason === 'boundary' || input.boundaryDecided) return 'boundary';
    if (input.closeReason === 'canceled') return 'canceled';
    if (input.closeReason === 'tuner-handoff') return 'tuner-handoff';
    if (input.now >= input.deadline) return 'scheduled-end';
    if (!input.managedEnd) return input.hasError ? 'failed' : 'stream-ended';
    if (!input.reconnectEnabled) return input.hasError ? 'failed' : 'stream-ended';
    return 'reconnect';
};

/** 再接続 attempt 番号に対応するバックオフ時間を返す。 */
export const getRecordingReconnectBackoffMs = (attempt: number): number =>
    BACKOFF_MS[Math.min(Math.max(0, Math.floor(attempt)), BACKOFF_MS.length - 1)];

export const BACKOFF_MS = [500, 1000, 2000, 5000] as const;
export const FIRST_DATA_TIMEOUT_MS = 10_000;
export const STABLE_MS = 30_000;
export const MAX_GAPS = 100;
