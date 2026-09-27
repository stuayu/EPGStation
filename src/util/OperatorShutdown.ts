/** Operator の終了シグナルを一度だけ graceful shutdown へ渡す。 */
export const createOperatorShutdownHandler = (
    shutdownRecordings: (signal: NodeJS.Signals) => Promise<void>,
    onExit: (code: number) => void,
    onError: (error: unknown) => void,
    timeoutMs: number = 20_000,
): ((signal: NodeJS.Signals) => Promise<void>) => {
    let shuttingDown = false;
    return async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown === true) {
            onExit(1);
            return;
        }
        shuttingDown = true;
        let timeout: NodeJS.Timeout | null = null;
        try {
            await Promise.race([
                shutdownRecordings(signal),
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(
                        () => reject(new Error(`Operator shutdown timed out after ${timeoutMs}ms`)),
                        timeoutMs,
                    );
                }),
            ]);
            if (timeout !== null) clearTimeout(timeout);
            onExit(0);
        } catch (err) {
            if (timeout !== null) clearTimeout(timeout);
            onError(err);
            onExit(1);
        }
    };
};
