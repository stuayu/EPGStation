import * as apid from '../../../../../api';

/**
 * プロセス単位のタブ情報
 */
export interface LogProcessTab {
    process: apid.LogProcessType;
    // 表示名 (Operator / Service / EPGUpdater)
    name: string;
    categories: LogCategoryTab[];
}

/**
 * カテゴリ (system / access / stream / encode) 単位のタブ情報
 */
export interface LogCategoryTab {
    category: string;
    // 現行ログ + ローテート済みログ
    files: apid.LogFileItem[];
}

export default interface ILogState {
    lines: string[];
    isTruncated: boolean;
    isLoading: boolean;
    selectedProcess: apid.LogProcessType | null;
    selectedCategory: string | null;
    selectedFileId: string | null;
    keyword: string;
    displayLines: number;

    clearData(): void;
    fetchFiles(): Promise<void>;
    fetchContent(): Promise<void>;
    getProcessTabs(): LogProcessTab[];
    getCategoryTabs(): LogCategoryTab[];
    getFiles(): apid.LogFileItem[];
    getSelectedFile(): apid.LogFileItem | null;
    getDownloadUrl(): string | null;
    selectProcess(process: apid.LogProcessType): void;
    selectCategory(category: string): void;
    selectFile(logFileId: string): void;
}
