import * as apid from '../../../../api';

export default interface IRecordingSessionApiModel {
    getByRecordedId(recordedId: apid.RecordedId): Promise<apid.RecordingSessions>;
    getRecordingResults(query: apid.RecordingResultQuery): Promise<apid.RecordingResultList>;
    getRecordingResultDetail(sessionId: number): Promise<apid.RecordingResultDetail | null>;
}
