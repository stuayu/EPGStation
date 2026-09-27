import IRecordingSessionDB from '../../db/IRecordingSessionDB';
import ILogger from '../../ILogger';
import RecordingAttempt from '../../../db/entities/RecordingAttempt';
import RecordingSession from '../../../db/entities/RecordingSession';
import Reserve from '../../../db/entities/Reserve';
import { RecordingSessionState, transitionRecordingSession } from './RecordingSessionState';
import { resolveRecordingStatus, RecordingResultStatus } from '../../../util/RecordingResult';
import telemetry from '../../observability/Telemetry';

/** 録画 session / attempt の永続化と span を管理する */
export default class RecordingSessionTracker {
    public session: RecordingSession | null = null;
    public telemetrySessionId: number | null = null;
    public currentAttempt: RecordingAttempt | null = null;
    public attemptCount = 0;
    public closeReasons: Array<string | null> = [];
    public gapCount = 0;

    private db: IRecordingSessionDB;
    private log: ILogger;

    constructor(db: IRecordingSessionDB, log: ILogger) {
        this.db = db;
        this.log = log;
    }

    /** session を永続化する */
    public async persist(values: Partial<RecordingSession>): Promise<void> {
        if (this.session === null) return;
        try {
            await this.db.updateSession(this.session.id, { ...values, updatedAt: Date.now() });
            Object.assign(this.session, values);
        } catch (err) {
            this.log.system.warn(`recording session update failed: ${this.session.id}`);
            this.log.system.warn(err);
        }
    }

    /** session 状態を遷移する */
    public async transition(event: Parameters<typeof transitionRecordingSession>[1]): Promise<void> {
        if (this.session === null) return;
        const result = transitionRecordingSession(this.session.state as RecordingSessionState, event);
        if (result.warning !== undefined) this.log.system.warn(result.warning);
        if (result.state !== this.session.state) await this.persist({ state: result.state });
    }

    /** 新しい録画 session と span を開始する */
    public async beginSession(reserve: Reserve): Promise<void> {
        const now = Date.now();
        try {
            this.session = await this.db.createSession({
                reserveId: reserve.id,
                recordedId: null,
                programId: reserve.programId,
                channelId: reserve.channelId,
                state: RecordingSessionState.PREPARING,
                scheduledStartAt: reserve.startAt,
                scheduledEndAt: reserve.endAt,
                actualStartAt: null,
                actualEndAt: null,
                startReason: null,
                endReason: null,
                resultStatus: null,
                retryCount: 0,
                createdAt: now,
                updatedAt: now,
            });
            this.telemetrySessionId = this.session.id;
            telemetry.recordingSessionStarted(this.session.id);
            this.attemptCount = 0;
            this.closeReasons = [];
            this.gapCount = 0;
        } catch (err) {
            this.session = null;
            this.log.system.warn(`recording session create failed: ${reserve.id}`);
            this.log.system.warn(err);
        }
    }

    /** 上流接続 attempt と span を開始する */
    public async beginAttempt(priority: number): Promise<void> {
        if (this.session === null) return;
        try {
            this.attemptCount++;
            this.currentAttempt = await this.db.createAttempt({
                sessionId: this.session.id,
                attemptNo: this.attemptCount,
                requestedAt: Date.now(),
                firstDataAt: null,
                endedAt: null,
                closeReason: null,
                errorCode: null,
                priority,
                bytesReceived: 0,
                fileOffsetStart: null,
                fileOffsetEnd: null,
            });
            telemetry.startRecordingAttempt(this.session.id, this.attemptCount);
            await this.persist({ retryCount: this.attemptCount - 1 });
        } catch (err) {
            this.log.system.warn(`recording attempt create failed: ${this.session.id}`);
            this.log.system.warn(err);
        }
    }

    /** 現 attempt を終了し理由と span を記録する */
    public async finishAttempt(reason: string | null, error?: Error, includeInResult = true): Promise<void> {
        const attempt = this.currentAttempt;
        if (attempt === null) return;
        this.currentAttempt = null;
        if (this.session !== null) {
            telemetry.finishRecordingAttempt(this.session.id, attempt.attemptNo, {
                'recording.close.reason': reason ?? 'unknown',
                'recording.attempt.error': error !== undefined,
            });
        }
        const values: Partial<RecordingAttempt> = {
            endedAt: Date.now(),
            closeReason: reason,
            errorCode: error === undefined ? null : String((error as NodeJS.ErrnoException).code ?? error.name),
            bytesReceived: attempt.bytesReceived,
            fileOffsetEnd:
                attempt.fileOffsetStart === null ? null : attempt.fileOffsetStart + (attempt.bytesReceived ?? 0),
        };
        if (includeInResult) this.closeReasons.push(reason);
        Object.assign(attempt, values);
        try {
            await this.db.updateAttempt(attempt.id, values);
        } catch (err) {
            this.log.system.warn(`recording attempt finish failed: ${attempt.id}`);
            this.log.system.warn(err);
        }
    }

    /** 接続終了理由と transport gap から録画結果を判定する */
    public resolveResult(endReason: string | null, canceled: boolean): RecordingResultStatus {
        return resolveRecordingStatus({
            closeReasons: [...this.closeReasons, endReason],
            transportGapCount: this.gapCount,
            canceled,
        });
    }

    /** session span を結果属性付きで閉じる */
    public closeTelemetrySession(status: string, endReason: string): void {
        if (this.telemetrySessionId === null) return;
        telemetry.recordingSessionEnded(this.telemetrySessionId, {
            'recording.result.status': status,
            'recording.end.reason': endReason,
        });
        this.telemetrySessionId = null;
    }
}
