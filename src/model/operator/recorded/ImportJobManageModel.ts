import { inject, injectable } from 'inversify';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IImportJobManageModel, { ImportJobId, ImportJobStatus } from './IImportJobManageModel';
import IRecordedManageModel, {
    ImportedExternalRecordedFileOption,
    ImportedExternalRecordedFileResult,
} from './IRecordedManageModel';

interface InternalJob extends ImportJobStatus {
    items: ImportedExternalRecordedFileOption[];
}

/**
 * 外部録画ファイル取り込みのバックグラウンドジョブを管理する
 * 1 件ずつ順次処理することで ffprobe 等の重い処理が API リクエストをブロックしないようにする
 */
@injectable()
export default class ImportJobManageModel implements IImportJobManageModel {
    private log: ILogger;
    private recordedManage: IRecordedManageModel;
    private jobs: Map<ImportJobId, InternalJob> = new Map();
    private jobSeq: number = 0;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
    ) {
        this.log = logger.getLogger();
        this.recordedManage = recordedManage;
    }

    /**
     * 取り込みジョブを開始する
     * @param items: ImportedExternalRecordedFileOption[]
     * @return ImportJobId
     */
    public start(items: ImportedExternalRecordedFileOption[]): ImportJobId {
        this.cleanup();

        const jobId = this.generateJobId();
        const job: InternalJob = {
            jobId,
            total: items.length,
            done: 0,
            successCount: 0,
            failedCount: 0,
            isRunning: true,
            createdAt: new Date().getTime(),
            results: [],
            items,
        };
        this.jobs.set(jobId, job);

        // バックグラウンドで実行し、呼び出し元には即座に jobId を返す
        this.run(job).catch(err => {
            this.log.system.error(`import job unexpected error: ${jobId}`);
            this.log.system.error(err);
            job.isRunning = false;
        });

        return jobId;
    }

    /**
     * ジョブ本体。1 件ずつ順次インポートし進捗を更新する
     * @param job: InternalJob
     */
    private async run(job: InternalJob): Promise<void> {
        for (const item of job.items) {
            const [result] = await this.recordedManage
                .importExternalRecordedFiles([item])
                .catch((err: any): ImportedExternalRecordedFileResult[] => [
                    {
                        localFilePath: item.localFilePath,
                        imported: false,
                        error: err instanceof Error ? err.message : String(err),
                    },
                ]);

            job.results.push(result);
            job.done++;
            if (result.imported === true) {
                job.successCount++;
            } else {
                job.failedCount++;
            }
        }

        job.isRunning = false;
    }

    /**
     * ジョブの進捗を取得する
     * @param jobId: ImportJobId
     * @return ImportJobStatus | null
     */
    public getStatus(jobId: ImportJobId): ImportJobStatus | null {
        const job = this.jobs.get(jobId);
        if (typeof job === 'undefined') {
            return null;
        }

        return {
            jobId: job.jobId,
            total: job.total,
            done: job.done,
            successCount: job.successCount,
            failedCount: job.failedCount,
            isRunning: job.isRunning,
            createdAt: job.createdAt,
            results: job.results,
        };
    }

    /**
     * 失敗したファイルのみを対象に新しいジョブを開始する
     * @param jobId: ImportJobId
     * @return ImportJobId | null
     */
    public retryFailed(jobId: ImportJobId): ImportJobId | null {
        const job = this.jobs.get(jobId);
        if (typeof job === 'undefined' || job.isRunning === true) {
            return null;
        }

        const failedPaths = new Set(job.results.filter(r => r.imported === false).map(r => r.localFilePath));
        const retryItems = job.items.filter(i => failedPaths.has(i.localFilePath));
        if (retryItems.length === 0) {
            return null;
        }

        return this.start(retryItems);
    }

    /**
     * 完了から一定時間経過したジョブ情報を破棄する (メモリリーク防止)
     */
    public cleanup(): void {
        const now = new Date().getTime();
        for (const [jobId, job] of this.jobs) {
            if (job.isRunning === false && now - job.createdAt > ImportJobManageModel.JOB_RETENTION_MS) {
                this.jobs.delete(jobId);
            }
        }
    }

    private generateJobId(): ImportJobId {
        this.jobSeq++;

        return `${new Date().getTime()}-${this.jobSeq}`;
    }

    // ジョブ完了後に状態を保持しておく期間 (ms)
    private static readonly JOB_RETENTION_MS = 30 * 60 * 1000;
}
