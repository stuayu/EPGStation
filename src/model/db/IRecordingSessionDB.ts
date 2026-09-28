import RecordingAttempt from '../../db/entities/RecordingAttempt';
import RecordingSession from '../../db/entities/RecordingSession';
import type { RecordingSessionState } from '../operator/recording/RecordingSessionState';

export interface RecordingResultQuery {
    result?: string;
    from?: number;
    to?: number;
    ruleId?: number;
    keyword?: string;
    offset: number;
    limit: number;
}

export default interface IRecordingSessionDB {
    createSession(data: Partial<RecordingSession>): Promise<RecordingSession>;
    updateSession(id: number, values: Partial<RecordingSession>): Promise<void>;
    createAttempt(data: Partial<RecordingAttempt>): Promise<RecordingAttempt>;
    updateAttempt(id: number, values: Partial<RecordingAttempt>): Promise<void>;
    findByState(state: RecordingSessionState): Promise<RecordingSession[]>;
    findByRecordedId(recordedId: number): Promise<RecordingSession[]>;
    findRecordingResults(query: RecordingResultQuery): Promise<{ items: RecordingSession[]; total: number }>;
    findById(id: number): Promise<RecordingSession | null>;
    findAttemptsBySessionId(sessionId: number): Promise<RecordingAttempt[]>;
    findAttemptsBySessionIds(sessionIds: number[]): Promise<RecordingAttempt[]>;
    deleteOrphanSessionsBefore(cutoff: number): Promise<number>;
}
