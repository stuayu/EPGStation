import RecordingAttempt from '../../db/entities/RecordingAttempt';
import RecordingSession from '../../db/entities/RecordingSession';
import type { RecordingSessionState } from '../operator/recording/RecordingSessionState';

export default interface IRecordingSessionDB {
    createSession(data: Partial<RecordingSession>): Promise<RecordingSession>;
    updateSession(id: number, values: Partial<RecordingSession>): Promise<void>;
    createAttempt(data: Partial<RecordingAttempt>): Promise<RecordingAttempt>;
    updateAttempt(id: number, values: Partial<RecordingAttempt>): Promise<void>;
    findByState(state: RecordingSessionState): Promise<RecordingSession[]>;
    findByRecordedId(recordedId: number): Promise<RecordingSession[]>;
    findAttemptsBySessionId(sessionId: number): Promise<RecordingAttempt[]>;
    findAttemptsBySessionIds(sessionIds: number[]): Promise<RecordingAttempt[]>;
    deleteOrphanSessionsBefore(cutoff: number): Promise<number>;
}
