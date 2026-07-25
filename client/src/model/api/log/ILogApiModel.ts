import * as apid from '../../../../../api';

export interface GetLogContentOption {
    lines?: number;
    keyword?: string;
}

export default interface ILogApiModel {
    getFiles(): Promise<apid.LogFiles>;
    getContent(logFileId: string, option?: GetLogContentOption): Promise<apid.LogFileContent>;
    getDownloadUrl(logFileId: string): string;
}
