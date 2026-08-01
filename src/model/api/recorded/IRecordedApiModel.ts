import * as apid from '../../../../api';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';

export interface NextUpResult {
    currentSeriesId: number | null;
    latest: apid.RecordedItem[];
    series: apid.RecordedItem[];
}

export default interface IRecordedApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null>;
    getSearchOptionList(): Promise<apid.RecordedSearchOptions>;
    delete(recordedId: apid.RecordedId): Promise<void>;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    getCleanupInfo(): Promise<apid.RecordedCleanupInfo>;
    fileCleanup(target?: apid.RecordedCleanupTarget): Promise<void>;
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<apid.RecordedId>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    getNextUp(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<NextUpResult | null>;
    scanImportDirectory(option: apid.ImportScanOption): Promise<apid.ImportScanResult>;
    startImportJob(option: apid.ImportRegisterOption): Promise<apid.ImportJobStartResult>;
    getImportJobStatus(jobId: string): Promise<apid.ImportJobStatus | null>;
    retryImportJob(jobId: string): Promise<apid.ImportJobStartResult | null>;
}
