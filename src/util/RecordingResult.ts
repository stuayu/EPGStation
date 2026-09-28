export type RecordingResultStatus = 'completed' | 'partial' | 'failed' | 'canceled';

export interface RecordingFinishPolicy {
    encode: boolean;
    removeOriginal: 'configured' | 'never' | 'not-applicable';
    runFinishCommand: boolean;
    notification: 'recording.completed' | 'recording.partial' | null;
}

/** 接続の終了理由から録画結果を判定する */
export function resolveRecordingStatus(input: {
    closeReasons: Array<string | null | undefined>;
    transportGapCount?: number;
    canceled?: boolean;
}): RecordingResultStatus {
    if (input.canceled === true || input.closeReasons.includes('canceled')) return 'canceled';
    if (input.closeReasons.some(reason => reason === 'write-error' || reason === 'error')) return 'failed';
    if (
        input.closeReasons.some(reason => reason === 'transport-lost' || reason === 'process-restart') ||
        (input.transportGapCount ?? 0) > 0
    )
        return 'partial';
    return 'completed';
}

/** 録画結果に応じた後処理を返す */
export function decideRecordingFinishPolicy(status: RecordingResultStatus | null): RecordingFinishPolicy {
    if (status === 'failed') {
        return { encode: false, removeOriginal: 'not-applicable', runFinishCommand: false, notification: null };
    }
    if (status === 'partial') {
        return { encode: true, removeOriginal: 'never', runFinishCommand: true, notification: 'recording.partial' };
    }
    return { encode: true, removeOriginal: 'configured', runFinishCommand: true, notification: 'recording.completed' };
}
