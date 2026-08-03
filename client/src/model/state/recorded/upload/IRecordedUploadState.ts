import * as apid from '../../../../../../api';

export interface SelectorItem {
    title: string;
    value: number;
}

/**
 * アップロードするファイルの指定方法
 * browser: 手元の PC からブラウザ経由でアップロードする
 * server: サーバー上 (config.importDirs 配下) のファイルを指定する
 */
export type VideoFileSource = 'browser' | 'server';

export interface VideoFileItem {
    key: number;
    parentDirectoryName: string | undefined;
    subDirectory: string | null;
    viewName: string | null;
    fileType: apid.VideoFileType | undefined;
    file: File | null | undefined;
    // ファイルの指定方法
    fileSource: VideoFileSource;
    // fileSource が server のときに指定する、サーバー上のファイルパス
    localFilePath: string | null;
}

/**
 * サーバー上のファイル選択ダイアログで表示する 1 件分
 */
export interface ServerFileItem {
    filePath: string;
    fileName: string;
    size?: number;
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
    // TS の PSI/SI から番組情報をサーバー側で自動取得するか
    isAutoDetect: boolean;
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
    setAutoDetect(isAutoDetect: boolean): void;
    checkInput(): boolean;
    upload(): Promise<void>;

    // 外部録画ファイル取り込み
    isExternalImportEnabled(): boolean;
    getImportDirItems(): string[];
    getImportDuplicateActionItems(): apid.ImportDuplicateAction[];
    getImportModeItems(): apid.ImportMode[];
    scanImportDirectory(): Promise<void>;
    listServerFiles(importDirName: string, subPath: string | null, recursive: boolean): Promise<ServerFileItem[]>;
    startImportRegistration(): Promise<void>;
    retryFailedImports(): Promise<void>;
}
