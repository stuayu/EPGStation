import * as apid from '../../../../api';

export enum LogApiErrors {
    FILE_IS_NOT_FOUND = 'FileIsNotFound',
}

export interface GetLogContentOption {
    // 末尾から取得する最大行数
    lines?: number;
    // 絞り込みキーワード (大文字小文字区別なし)
    keyword?: string;
}

export default interface ILogApiModel {
    getFiles(): Promise<apid.LogFiles>;
    getContent(logFileId: string, option?: GetLogContentOption): Promise<apid.LogFileContent | null>;
    getFilePath(logFileId: string): Promise<string | null>;
}
