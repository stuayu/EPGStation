import * as apid from '../../../../../api';

/**
 * 次に見る候補の取得条件
 * target を指定すると片方のリストだけを引く (無限スクロールの追加読み込み用)
 */
export interface NextUpRequestOption {
    limit?: number;
    offset?: number;
    target?: 'all' | 'latest' | 'series';
}

export interface NextUpResponse {
    currentSeriesId: number | null;
    latest: apid.RecordedItem[];
    series: apid.RecordedItem[];
    // それぞれ続きがあるか
    hasMoreLatest: boolean;
    hasMoreSeries: boolean;
}

export default interface IRecordedApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem>;
    getSearchOptionList(): Promise<apid.RecordedSearchOptions>;
    delete(recordedId: apid.RecordedId): Promise<void>;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    protect(recordedId: apid.RecordedId): Promise<void>;
    unprotect(recordedId: apid.RecordedId): Promise<void>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    getNextUp(recordedId: apid.RecordedId, isHalfWidth: boolean, option?: NextUpRequestOption): Promise<NextUpResponse | null>;
    getCleanupInfo(): Promise<apid.RecordedCleanupInfo>;
    cleanup(target?: apid.RecordedCleanupTarget): Promise<void>;
    scanImportDirectory(option: apid.ImportScanOption): Promise<apid.ImportScanResult>;
    startImportJob(option: apid.ImportRegisterOption): Promise<apid.ImportJobStartResult>;
    getImportJobStatus(jobId: string): Promise<apid.ImportJobStatus | null>;
    retryImportJob(jobId: string): Promise<apid.ImportJobStartResult | null>;
}
