import { ImportedExternalRecordedFileOption, ImportedExternalRecordedFileResult } from './IRecordedManageModel';

export type ImportJobId = string;

export interface ImportJobStatus {
    jobId: ImportJobId;
    total: number;
    done: number;
    successCount: number;
    failedCount: number;
    isRunning: boolean;
    createdAt: number;
    results: ImportedExternalRecordedFileResult[];
}

export default interface IImportJobManageModel {
    /**
     * 外部録画ファイル取り込みジョブをバックグラウンドで開始する
     * @param items: ImportedExternalRecordedFileOption[]
     * @return ImportJobId 即座に発行される job id (処理はバックグラウンドで継続する)
     */
    start(items: ImportedExternalRecordedFileOption[]): ImportJobId;

    /**
     * ジョブの進捗を取得する
     * @param jobId: ImportJobId
     * @return ImportJobStatus | null 存在しない場合は null
     */
    getStatus(jobId: ImportJobId): ImportJobStatus | null;

    /**
     * 指定した jobId の失敗ファイルのみを再実行する新しいジョブを開始する
     * @param jobId: ImportJobId
     * @return ImportJobId | null 元ジョブが存在しない、または失敗ファイルが無い場合は null
     */
    retryFailed(jobId: ImportJobId): ImportJobId | null;

    // 未使用のジョブ情報を掃除する
    cleanup(): void;
}
