import * as http from 'http';
import IRecordingStreamCreator from './IRecordingStreamCreator';
import RecordingSink from './RecordingSink';
import {
    decideRecordingStreamEnd,
    FIRST_DATA_TIMEOUT_MS,
    getRecordingReconnectBackoffMs,
    MAX_GAPS,
    RecordingStreamEndDecision,
    STABLE_MS,
} from './RecordingStreamEndPolicy';
import TsPacketFramer from './TsPacketFramer';
import Reserve from '../../../db/entities/Reserve';

export interface RecordingUpstreamSessionOptions {
    creator: IRecordingStreamCreator;
    reserve: Reserve;
    sink: RecordingSink;
    deadline: () => number;
    managedEnd: boolean;
    reconnectEnabled: boolean;
    isCurrent: () => boolean;
    boundaryDecided: () => boolean;
    onAttemptStart: (offset: number) => Promise<void>;
    onAttemptEnd: (reason: string | null, error?: Error) => Promise<void>;
    onChunk: (chunk: Buffer) => void;
    onFirstData: (stream: http.IncomingMessage) => Promise<void>;
    onStartError: (error: Error) => void;
    onReconnectState: (reconnecting: boolean) => void;
    onGapStart: (reason: string) => void;
    onGapEnd: () => void;
    onWriteError: (error: Error) => void;
    onReconnectError: (error: Error, attempt: number) => void;
    preserveRawBytes?: boolean;
}

interface StreamEnd {
    error?: Error;
}

/** 上流接続、TS packet framing、背圧、録画中再接続を管理する。 */
export default class RecordingUpstreamSession {
    private readonly options: RecordingUpstreamSessionOptions;
    private stopped = false;
    private currentStream: http.IncomingMessage | null = null;
    private reconnectAbort: AbortController | null = null;
    private reconnectAttempt = 0;
    private gapCount = 0;
    private stableTimer: NodeJS.Timeout | null = null;

    constructor(options: RecordingUpstreamSessionOptions) {
        this.options = options;
    }

    /** 初回接続を引き継ぎ、終了または停止まで上流を管理する。 */
    public async run(
        initialStream: http.IncomingMessage,
        initialChunks: Buffer[] = [],
    ): Promise<RecordingStreamEndDecision> {
        let source: http.IncomingMessage | null = initialStream;
        let chunks = initialChunks;
        while (!this.stopped && this.options.isCurrent()) {
            if (source === null) {
                this.options.onReconnectState(true);
                const deadline = this.options.deadline();
                const waitMs = Math.min(
                    getRecordingReconnectBackoffMs(Math.max(0, this.reconnectAttempt - 1)),
                    deadline - Date.now(),
                );
                if (waitMs <= 0) return 'scheduled-end';
                await this.delay(waitMs);
                if (this.stopped || !this.options.isCurrent()) return 'canceled';
                if (Date.now() >= this.options.deadline()) return 'scheduled-end';

                const controller = new AbortController();
                this.reconnectAbort = controller;
                await this.options.onAttemptStart(this.options.sink.getBytesWritten());
                try {
                    source = await this.options.creator.reconnect(this.options.reserve, controller.signal);
                    if (this.stopped || !this.options.isCurrent()) {
                        this.options.creator.closeStream(source, 'canceled');
                        await this.options.onAttemptEnd('canceled');
                        return 'canceled';
                    }
                    this.currentStream = source;
                    this.reconnectAbort = null;
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    await this.options.onAttemptEnd(null, err);
                    if (this.stopped) return 'canceled';
                    this.reconnectAttempt++;
                    this.gapCount++;
                    if (this.shouldLogReconnect()) this.options.onReconnectError(err, this.reconnectAttempt);
                    if (this.gapCount >= MAX_GAPS) return 'reconnect';
                    continue;
                }
                chunks = [];
            }

            const result = await this.consume(source, chunks);
            source = null;
            chunks = [];
            this.currentStream = null;
            const closeReason = this.options.creator.getCloseReason(result.stream);
            await this.options.onAttemptEnd(closeReason, result.error);
            if (this.stopped) return 'canceled';

            const decision = decideRecordingStreamEnd({
                closeReason,
                hasError: result.error !== undefined,
                now: Date.now(),
                deadline: this.options.deadline(),
                managedEnd: this.options.managedEnd,
                isCurrent: this.options.isCurrent(),
                boundaryDecided: this.options.boundaryDecided(),
                reconnectEnabled: this.options.reconnectEnabled,
            });
            if (this.stableTimer !== null) clearTimeout(this.stableTimer);
            this.stableTimer = null;
            if (decision !== 'reconnect' || this.gapCount >= MAX_GAPS) return decision;
            const reason =
                (result.error as NodeJS.ErrnoException | undefined)?.code ?? (result.error ? 'error' : 'upstream-eof');
            this.options.onGapStart(String(reason));
            this.options.onReconnectState(true);
            this.reconnectAttempt++;
            this.gapCount++;
        }
        return 'ignore';
    }

    /** 再接続待機と接続中処理を止める。 */
    public stop(reason: Exclude<IRecordingStreamCreator.CloseReason, null> = 'canceled'): void {
        this.stopped = true;
        if (this.stableTimer !== null) clearTimeout(this.stableTimer);
        this.reconnectAbort?.abort();
        if (this.currentStream !== null) this.options.creator.closeStream(this.currentStream, reason);
    }

    private consume(
        source: http.IncomingMessage,
        initialChunks: Buffer[],
    ): Promise<{ stream: http.IncomingMessage; error?: Error }> {
        this.currentStream = source;
        const framer = new TsPacketFramer();
        let firstData = initialChunks.length > 0;
        let settled = false;
        let dataTimeout: NodeJS.Timeout | null = null;

        return new Promise(resolve => {
            const cleanup = (): void => {
                if (dataTimeout !== null) clearTimeout(dataTimeout);
                source.removeListener('data', onData);
                source.removeListener('end', onEnd);
                source.removeListener('close', onClose);
                source.removeListener('error', onError);
                this.options.sink.passThrough.removeListener('drain', onDrain);
            };
            const finish = (result: StreamEnd = {}): void => {
                if (settled) return;
                settled = true;
                framer.reset();
                cleanup();
                resolve({ stream: source, ...result });
            };
            const onDrain = (): void => {
                source.resume();
            };
            const onData = (chunk: Buffer): void => {
                if (!firstData) {
                    firstData = true;
                    if (dataTimeout !== null) clearTimeout(dataTimeout);
                    this.options.onGapEnd();
                    if (this.gapCount > 0) this.options.onReconnectState(false);
                    this.startStableTimer();
                    source.pause();
                    void Promise.resolve(this.options.onFirstData(source))
                        .then(() => source.resume())
                        .catch(error => {
                            const err = error instanceof Error ? error : new Error(String(error));
                            this.options.onStartError(err);
                            this.options.creator.markClose(source, 'teardown');
                            finish({ error: err });
                        });
                }
                this.options.onChunk(chunk);
                try {
                    const packets = this.options.preserveRawBytes === true ? chunk : framer.push(chunk);
                    if (packets !== null && !this.options.sink.write(packets)) {
                        source.pause();
                        this.options.sink.passThrough.once('drain', onDrain);
                    }
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    this.options.creator.markClose(source, 'write-error');
                    this.options.onWriteError(err);
                    finish({ error: err });
                }
            };
            const onEnd = (): void => finish();
            const onClose = (): void => {
                const error = source.errored;
                finish(error instanceof Error ? { error } : {});
            };
            const onError = (error: Error): void => finish({ error });

            source.on('data', onData);
            source.once('end', onEnd);
            source.once('close', onClose);
            source.once('error', onError);
            const alreadyEnded = source.readableEnded === true || source.destroyed === true;
            if (this.gapCount > 0) {
                const firstDataWaitMs = Math.min(
                    FIRST_DATA_TIMEOUT_MS,
                    Math.max(0, this.options.deadline() - Date.now()),
                );
                dataTimeout = setTimeout(() => {
                    this.options.creator.closeStream(source, 'reconnect-no-data');
                    finish();
                }, firstDataWaitMs);
            }
            if (initialChunks.length > 0) {
                firstData = true;
                this.options.onGapEnd();
                if (this.gapCount > 0) this.options.onReconnectState(false);
                this.startStableTimer();
                source.pause();
                void Promise.resolve(this.options.onFirstData(source))
                    .then(() => {
                        for (const chunk of initialChunks) onData(chunk);
                        source.resume();
                        if (alreadyEnded) {
                            const error = source.errored;
                            finish(error instanceof Error ? { error } : {});
                        }
                    })
                    .catch(error => {
                        const err = error instanceof Error ? error : new Error(String(error));
                        this.options.onStartError(err);
                        this.options.creator.markClose(source, 'teardown');
                        finish({ error: err });
                    });
            } else {
                if (alreadyEnded) {
                    const error = source.errored;
                    finish(error instanceof Error ? { error } : {});
                } else {
                    source.resume();
                }
            }
        });
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => {
            const until = Date.now() + ms;
            const poll = (): void => {
                if (this.stopped || Date.now() >= until) return resolve();
                setTimeout(poll, Math.min(50, Math.max(1, until - Date.now())));
            };
            poll();
        });
    }

    private shouldLogReconnect(): boolean {
        return this.reconnectAttempt <= 5 || this.reconnectAttempt % 12 === 0;
    }

    private startStableTimer(): void {
        if (this.stableTimer !== null) clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => {
            this.reconnectAttempt = 0;
            this.stableTimer = null;
        }, STABLE_MS);
    }
}
