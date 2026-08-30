export interface EventStreamFallbackState {
    consecutiveSilentDisconnects: number;
    polling: boolean;
}

/** event stream の状態を polling 切替状態へ遷移させる純粋関数。 */
export const onEventStreamDisconnected = (
    state: EventStreamFallbackState,
    receivedEvent: boolean,
    threshold: number,
): EventStreamFallbackState => {
    const count = receivedEvent ? 0 : state.consecutiveSilentDisconnects + 1;
    return { consecutiveSilentDisconnects: count, polling: state.polling || count >= Math.max(1, threshold) };
};

/** event stream がイベントを受信したとき polling を停止する。 */
export const onEventStreamStarted = (): EventStreamFallbackState => ({
    consecutiveSilentDisconnects: 0,
    polling: false,
});
