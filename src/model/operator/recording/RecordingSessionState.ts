export const RecordingSessionState = {
    SCHEDULED: 'SCHEDULED',
    PREPARING: 'PREPARING',
    WAITING_BOUNDARY: 'WAITING_BOUNDARY',
    RECORDING: 'RECORDING',
    RECONNECTING: 'RECONNECTING',
    FINALIZING: 'FINALIZING',
    FINISHED: 'FINISHED',
} as const;

export type RecordingSessionState = (typeof RecordingSessionState)[keyof typeof RecordingSessionState];

export const RecordingSessionEvent = {
    PREPARE: 'prepare',
    WAIT_BOUNDARY: 'wait-boundary',
    FIRST_DATA: 'first-data',
    RECONNECT: 'reconnect',
    RECONNECTED: 'reconnected',
    FINALIZE: 'finalize',
    FINISH: 'finish',
    FAIL: 'fail',
    CANCEL: 'cancel',
} as const;

export type RecordingSessionEvent = (typeof RecordingSessionEvent)[keyof typeof RecordingSessionEvent];

const transitions: Record<RecordingSessionState, Partial<Record<RecordingSessionEvent, RecordingSessionState>>> = {
    SCHEDULED: { prepare: 'PREPARING', cancel: 'FINALIZING' },
    PREPARING: {
        'wait-boundary': 'WAITING_BOUNDARY',
        'first-data': 'RECORDING',
        fail: 'FINALIZING',
        cancel: 'FINALIZING',
    },
    WAITING_BOUNDARY: { 'first-data': 'RECORDING', fail: 'FINALIZING', cancel: 'FINALIZING' },
    RECORDING: { reconnect: 'RECONNECTING', finalize: 'FINALIZING', fail: 'FINALIZING', cancel: 'FINALIZING' },
    RECONNECTING: {
        reconnect: 'RECONNECTING',
        reconnected: 'RECORDING',
        finalize: 'FINALIZING',
        fail: 'FINALIZING',
        cancel: 'FINALIZING',
    },
    FINALIZING: { finish: 'FINISHED' },
    FINISHED: {},
};

/** 録画セッション状態を遷移させる。不許可イベントは状態を保ち警告文を返す */
export function transitionRecordingSession(
    state: RecordingSessionState,
    event: RecordingSessionEvent,
): { state: RecordingSessionState; warning?: string } {
    const next = transitions[state][event];
    return next === undefined
        ? { state, warning: `Ignoring invalid recording session transition: ${state} + ${event}` }
        : { state: next };
}
