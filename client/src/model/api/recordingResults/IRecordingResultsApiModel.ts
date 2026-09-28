import * as apid from '../../../../../api';

export interface RecordingResultsOption {
    result?: 'completed' | 'partial' | 'failed' | 'canceled';
    from?: number;
    to?: number;
    ruleId?: number;
    keyword?: string;
    offset?: number;
    limit?: number;
}

export default interface IRecordingResultsApiModel {
    getResults(option: RecordingResultsOption): Promise<apid.RecordingResultList>;
    getResult(sessionId: number): Promise<apid.RecordingResultDetail>;
}
