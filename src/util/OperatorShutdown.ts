/** Operator の終了シグナルを一度だけ graceful shutdown へ渡す。 */
export const createOperatorShutdownHandler = (
    shutdownRecordings: (signal: NodeJS.Signals) => Promise<void>,
    onExit: (code: number) => void,
    onError: (error: unknown) => void,
): ((signal: NodeJS.Signals) => Promise<void>) => {
    let shuttingDown = false;
    return async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown === true) return;
        shuttingDown = true;
        try {
            await shutdownRecordings(signal);
            onExit(0);
        } catch (err) {
            onError(err);
            onExit(1);
        }
    };
};
