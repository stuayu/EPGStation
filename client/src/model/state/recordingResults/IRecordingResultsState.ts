import * as apid from '../../../../../api';
import { RecordingResultsOption } from '../../api/recordingResults/IRecordingResultsApiModel';

export default interface IRecordingResultsState {
    getItems(): apid.RecordingResultSession[];
    getTotal(): number;
    getDetail(sessionId: number): apid.RecordingResultDetail | undefined;
    fetch(option: RecordingResultsOption): Promise<void>;
    fetchDetail(sessionId: number): Promise<apid.RecordingResultDetail>;
}
