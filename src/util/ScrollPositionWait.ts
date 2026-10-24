interface EventEmitterLike {
    once(eventName: string, listener: () => void): unknown;
    removeListener(eventName: string, listener: () => void): unknown;
}

/** 完了イベントか timeout まで待ち、待機リスナーを解放する。 */
export async function waitForEventOrTimeout(
    eventEmitter: EventEmitterLike,
    eventName: string,
    timeoutMs: number,
): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const finish = (received: boolean): void => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            eventEmitter.removeListener(eventName, onEvent);
            resolve(received);
        };
        const onEvent = (): void => finish(true);
        timer = setTimeout(() => finish(false), timeoutMs);

        eventEmitter.once(eventName, onEvent);
    });
}
