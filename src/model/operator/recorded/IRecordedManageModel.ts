import * as apid from '../../../../api';

export interface AddVideoFileOption {
    recordedId: apid.RecordedId;
    parentDirectoryName: string; // 親ディレクトリ名 (config.yaml)
    filePath: string; // 親ディレクトリから下のファイルパス
    type: apid.VideoFileType;
    name: string;
    // register モード (取り込み専用) で追加された、EPGStation 管理外の実ファイルかどうか
    isExternalFile?: boolean;
}

// 取り込みモード。register: 元ファイルを移動せずそのまま登録する / move: 録画ディレクトリへ移動する
export type ImportMode = 'register' | 'move';

// 重複が見つかった場合の挙動。skip: 取り込まない / add: 既存 recorded に video file を追加 / newRecorded: 別の録画として新規登録する
export type ImportDuplicateAction = 'skip' | 'add' | 'newRecorded';

/**
 * 外部録画ファイル取り込み 1 件あたりのオプション
 * localFilePath は必ず IConfigFile.importDirs 配下の実パスであることをサーバ側 (Operator) で検証する
 */
export interface ImportedExternalRecordedFileOption {
    localFilePath: string;
    parentDirectoryName: string;
    subDirectory?: string;
    fileType: apid.VideoFileType;
    channelId: apid.ChannelId;
    mode?: ImportMode; // 省略時は config.importDefaultMode (既定 register)
    name?: string; // 推定された番組名 (省略時はファイル名から生成)
    startAt?: number; // 推定された開始時刻 (省略時はファイルの mtime を使用)
    endAt?: number; // 推定された終了時刻 (省略時は動画長から算出)
    duplicateAction?: ImportDuplicateAction; // 省略時は newRecorded
    duplicateRecordedId?: apid.RecordedId; // duplicateAction: 'add' の場合に追加先となる recorded id
    ruleId?: apid.RuleId;
    genre1?: apid.ProgramGenreLv1;
    subGenre1?: apid.ProgramGenreLv2;
}

export interface ImportedExternalRecordedFileResult {
    localFilePath: string;
    imported: boolean;
    skipped?: boolean;
    recordedId?: apid.RecordedId;
    name?: string;
    error?: string;
}

/**
 * アップロードされたビデオファイル情報
 */
export interface UploadedVideoFileOption {
    // 紐付ける recorded id。省略した場合は TS を解析して番組情報を新規作成する (fileType が ts のときのみ)
    recordedId?: apid.RecordedId;
    parentDirectoryName: string; // 保存先ディレクトリ名
    subDirectory?: string; // 保存先サブディレクトリ
    viewName: string; // UI 上での表示名
    fileType: apid.VideoFileType; // ファイルタイプ
    fileName?: string; // ファイル名
    filePath?: string; // ファイルパス (アップロード先)
    localFilePath?: string; // アップロードファイルのローカルパス
}

export default interface IRecordedManageModel {
    delete(recordedId: apid.RecordedId): Promise<void>;
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId>;
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<apid.RecordedId>;
    importExternalRecordedFiles(
        option: ImportedExternalRecordedFileOption[],
    ): Promise<ImportedExternalRecordedFileResult[]>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    deleteVideoFile(videoFileid: apid.VideoFileId, isIgnoreProtection?: boolean): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    historyCleanup(): Promise<void>;
    getCleanupInfo(): Promise<apid.RecordedCleanupInfo>;
    videoFileCleanup(): Promise<void>;
    dropLogFileCleanup(): Promise<void>;
    removeRuleId(ruleId: apid.RuleId): Promise<void>;
}
