import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordingSessionDB from '../../db/IRecordingSessionDB';
import IRecordingSessionApiModel from './IRecordingSessionApiModel';
import { RecordingResultQuery } from '../../db/IRecordingSessionDB';

@injectable()
export default class RecordingSessionApiModel implements IRecordingSessionApiModel {
    constructor(@inject('IRecordingSessionDB') private recordingSessionDB: IRecordingSessionDB) {}

    /**
     * 録画 ID に紐づくセッションと接続試行を取得する
     * @param recordedId 録画 ID
     * @return セッションと接続試行
     */
    public async getByRecordedId(recordedId: apid.RecordedId): Promise<apid.RecordingSessions> {
        const sessions = await this.recordingSessionDB.findByRecordedId(recordedId);
        const attempts = await this.recordingSessionDB.findAttemptsBySessionIds(sessions.map(session => session.id));
        const attemptsBySession = new Map<number, typeof attempts>();
        for (const attempt of attempts) {
            const group = attemptsBySession.get(attempt.sessionId) ?? [];
            group.push(attempt);
            attemptsBySession.set(attempt.sessionId, group);
        }
        const items: apid.RecordingSessionItem[] = [];
        for (const session of sessions) {
            const sessionAttempts = attemptsBySession.get(session.id) ?? [];
            items.push({
                id: session.id,
                reserveId: session.reserveId,
                recordedId: session.recordedId ?? undefined,
                programId: session.programId ?? undefined,
                channelId: session.channelId,
                state: session.state,
                scheduledStartAt: session.scheduledStartAt,
                scheduledEndAt: session.scheduledEndAt,
                actualStartAt: session.actualStartAt ?? undefined,
                actualEndAt: session.actualEndAt ?? undefined,
                startReason: session.startReason ?? undefined,
                endReason: session.endReason ?? undefined,
                resultStatus: session.resultStatus ?? undefined,
                retryCount: session.retryCount,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                attempts: sessionAttempts.map(attempt => ({
                    id: attempt.id,
                    sessionId: attempt.sessionId,
                    attemptNo: attempt.attemptNo,
                    requestedAt: attempt.requestedAt,
                    firstDataAt: attempt.firstDataAt ?? undefined,
                    endedAt: attempt.endedAt ?? undefined,
                    closeReason: attempt.closeReason ?? '',
                    errorCode: attempt.errorCode ?? '',
                    priority: attempt.priority,
                    bytesReceived: attempt.bytesReceived,
                    fileOffsetStart: attempt.fileOffsetStart ?? undefined,
                    fileOffsetEnd: attempt.fileOffsetEnd ?? undefined,
                })),
            });
        }
        return { sessions: items };
    }

    /** 録画結果一覧を条件付きで取得する */
    public async getRecordingResults(query: apid.RecordingResultQuery): Promise<apid.RecordingResultList> {
        const result = await this.recordingSessionDB.findRecordingResults(query as RecordingResultQuery);
        return {
            items: result.items.map(session => this.toResultSession(session)),
            total: result.total,
            offset: query.offset,
            limit: query.limit,
        };
    }

    /** 録画結果とその接続試行を取得する */
    public async getRecordingResultDetail(sessionId: number): Promise<apid.RecordingResultDetail | null> {
        const session = await this.recordingSessionDB.findById(sessionId);
        if (session === null) return null;
        const attempts = await this.recordingSessionDB.findAttemptsBySessionId(sessionId);
        return {
            session: this.toResultSession(session),
            attempts: attempts.map(attempt => ({
                id: attempt.id,
                sessionId: attempt.sessionId,
                attemptNo: attempt.attemptNo,
                requestedAt: attempt.requestedAt,
                firstDataAt: attempt.firstDataAt ?? undefined,
                endedAt: attempt.endedAt ?? undefined,
                closeReason: attempt.closeReason ?? '',
                errorCode: attempt.errorCode ?? '',
                priority: attempt.priority,
                bytesReceived: attempt.bytesReceived,
                fileOffsetStart: attempt.fileOffsetStart ?? undefined,
                fileOffsetEnd: attempt.fileOffsetEnd ?? undefined,
            })),
        };
    }

    private toResultSession(
        session: import('../../../db/entities/RecordingSession').default,
    ): apid.RecordingResultSession {
        return {
            id: session.id,
            reserveId: session.reserveId,
            recordedId: session.recordedId ?? undefined,
            programId: session.programId ?? undefined,
            channelId: session.channelId,
            state: session.state,
            scheduledStartAt: session.scheduledStartAt,
            scheduledEndAt: session.scheduledEndAt,
            actualStartAt: session.actualStartAt ?? undefined,
            actualEndAt: session.actualEndAt ?? undefined,
            startReason: session.startReason ?? undefined,
            endReason: session.endReason ?? undefined,
            resultStatus: session.resultStatus ?? undefined,
            retryCount: session.retryCount,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            name: session.name ?? undefined,
            channelName: session.channelName ?? undefined,
            ruleId: session.ruleId ?? undefined,
            isTimeSpecified: session.isTimeSpecified,
        };
    }
}
