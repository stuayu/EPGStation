import * as apid from '../../../../../../api';

export interface SelectorItem {
    title: string;
    value: number;
}

export interface VideoFileItem {
    key: number;
    parentDirectoryName: string | undefined;
    subDirectory: string | null;
    viewName: string | null;
    fileType: apid.VideoFileType | undefined;
    file: File | null | undefined;
}

/**
 * スキャン結果 1 件 + UI 上での編集状態
 */
export interface ImportScanRowItem {
    result: apid.ImportScanResultItem;
    selected: boolean;
    editedName: string;
    editedChannelId: apid.ChannelId | undefined;
    duplicateAction: apid.ImportDuplicateAction;
    mode: apid.ImportMode;
}

export interface UploadProgramOption {
    ruleId: apid.RuleId | null | undefined;
    channelId: apid.ChannelId | undefined;
    startAt: Date | null;
    duration: number | null;
    name: string | null;
    description: string | null;
    extended: string | null;
    genre1: apid.ProgramGenreLv1 | undefined;
    subGenre1: apid.ProgramGenreLv2 | undefined;
}

export default interface IRecordedUploadState {
    programOption: UploadProgramOption;
    videoFileItems: VideoFileItem[];
    ruleKeyword: string | null;
    ruleItems: apid.RuleKeywordItem[];
    isShowPeriod: boolean;

    // 外部録画ファイル取り込みウィザード用の状態 (featureFlags.externalFileImport が有効な場合のみ使用する)
    importDirName: string | undefined;
    importSubPath: string | null;
    importRecursive: boolean;
    importParentDirectoryName: string | undefined;
    importScanResults: ImportScanRowItem[];
    importJobStatus: apid.ImportJobStatus | null;
    importIsScanning: boolean;

    init(): void;
    fetchData(): Promise<void>;
    updateRuleItems(): Promise<void>;
    getChannelItems(): SelectorItem[];
    getPrentDirectoryItems(): string[];
    getFileTypeItems(): apid.VideoFileType[];
    getGenreItems(): SelectorItem[];
    getSubGenreItems(): SelectorItem[];
    addEmptyVideoFileItem(): void;
    checkInput(): boolean;
    upload(): Promise<void>;

    // 外部録画ファイル取り込み
    isExternalImportEnabled(): boolean;
    getImportDirItems(): string[];
    getImportDuplicateActionItems(): apid.ImportDuplicateAction[];
    getImportModeItems(): apid.ImportMode[];
    scanImportDirectory(): Promise<void>;
    startImportRegistration(): Promise<void>;
    retryFailedImports(): Promise<void>;
}
