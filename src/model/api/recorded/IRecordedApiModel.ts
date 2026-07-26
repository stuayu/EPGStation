import * as apid from '../../../../api';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';

export interface NextUpResult {
    currentSeriesId: number | null;
    latest: apid.RecordedItem[];
    series: apid.RecordedItem[];
}

export interface ImportExternalRecordedFilesResult {
    items: Array<{
        localFilePath: string;
        imported: boolean;
        recordedId?: apid.RecordedId;
        name?: string;
        error?: string;
    }>;
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
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    getNextUp(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<NextUpResult | null>;
    importExternalRecordedFiles(option: {
        channelId: apid.ChannelId;
        parentDirectoryName: string;
        subDirectory?: string;
        fileType: apid.VideoFileType;
        localFilePaths: string[];
        ruleId?: apid.RuleId;
        genre1?: apid.ProgramGenreLv1;
        subGenre1?: apid.ProgramGenreLv2;
    }): Promise<ImportExternalRecordedFilesResult>;
}
