import * as apid from '../../../../api';

export default interface IRecordingSessionApiModel {
    getByRecordedId(recordedId: apid.RecordedId): Promise<apid.RecordingSessions>;
}
