import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import IVideoFileDB from '../db/IVideoFileDB';
import IVideoFileTsInfoDB from '../db/IVideoFileTsInfoDB';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IVideoAnalyzeJobModel, { StartVideoAnalyzeJobOption, VideoAnalyzeJob } from './IVideoAnalyzeJobModel';
import IVideoFileAnalyzeModel from './IVideoFileAnalyzeModel';

/**
 * 録画ファイルの一括解析ジョブ。
 *
 * 以前はクライアントが 100 件ずつ API を呼び続けていたため、画面を閉じる・
 * 再読み込みするだけで処理が止まり、進捗も失われていた。ジョブを Service プロセス側に
 * 常駐させ、進捗 (`getJob`) をポーリングで取れるようにしている。
 * ジョブはプロセスが生きている間だけ保持する (EPGStation の再起動では失われる)
 */
@injectable()
export default class VideoAnalyzeJobModel implements IVideoAnalyzeJobModel {
    // 1 回の DB 取得件数 (件数が多いので全件をメモリに載せない)
    private static readonly CHUNK_SIZE = 100;
    // 失敗理由をログに残す件数 (16000 件規模でログを埋めないため)
    private static readonly LOG_LIMIT = 3;

    private log: ILogger | null;
    private job: VideoAnalyzeJob = VideoAnalyzeJobModel.emptyJob();
    private cancelRequested: boolean = false;

    constructor(
        @inject('IVideoFileDB') private videoFileDB: IVideoFileDB,
        @inject('IVideoFileTsInfoDB') private videoFileTsInfoDB: IVideoFileTsInfoDB,
        @inject('IVideoFileAnalyzeModel') private analyzeModel: IVideoFileAnalyzeModel,
        @inject('ILoggerModel') logger?: ILoggerModel,
    ) {
        this.log = typeof logger === 'undefined' ? null : logger.getLogger();
    }

    private static emptyJob(): VideoAnalyzeJob {
        return {
            status: 'idle',
            type: null,
            mode: null,
            total: 0,
            processed: 0,
            analyzed: 0,
            failed: 0,
            startedAt: null,
            finishedAt: null,
            error: null,
        };
    }

    public getJob(): VideoAnalyzeJob {
        return { ...this.job };
    }

    public async start(option: StartVideoAnalyzeJobOption): Promise<VideoAnalyzeJob> {
        if (this.job.status === 'running') throw new Error('VideoAnalyzeJobIsAlreadyRunning');

        const type = option?.type;
        const mode = option?.mode ?? 'unanalyzed';
        if (type !== 'metadata' && type !== 'tsInfo') throw new Error('InvalidVideoAnalyzeJobType');
        if (mode !== 'unanalyzed' && mode !== 'all') throw new Error('InvalidVideoAnalyzeJobMode');

        const total = await this.countTargets(type, mode);

        this.cancelRequested = false;
        this.job = {
            status: 'running',
            type: type,
            mode: mode,
            total: total,
            processed: 0,
            analyzed: 0,
            failed: 0,
            startedAt: Date.now(),
            finishedAt: null,
            error: null,
        };

        // 応答を待たせないようジョブは非同期で進める
        this.execute(type, mode).catch(err => {
            this.log?.system.error(err);
        });

        return this.getJob();
    }

    public cancel(): VideoAnalyzeJob {
        if (this.job.status === 'running') this.cancelRequested = true;

        return this.getJob();
    }

    /**
     * 解析対象の総件数を返す
     */
    private async countTargets(type: apid.VideoAnalyzeJobType, mode: apid.VideoAnalyzeJobMode): Promise<number> {
        if (type === 'metadata') {
            return mode === 'all' ? await this.videoFileDB.countAll() : await this.videoFileDB.countWithoutMetadata();
        }

        return mode === 'all'
            ? await this.videoFileTsInfoDB.countAnalyzableVideoFiles()
            : await this.videoFileTsInfoDB.countWithoutTsInfo();
    }

    /**
     * ジョブ本体。CHUNK_SIZE 件ずつ取り出して解析する
     */
    private async execute(type: apid.VideoAnalyzeJobType, mode: apid.VideoAnalyzeJobMode): Promise<void> {
        try {
            let offset = 0;
            for (;;) {
                const targets = await this.findTargets(type, mode, offset);
                if (targets.length === 0) break;

                for (const target of targets) {
                    if (this.cancelRequested === true) {
                        this.finish('canceled');

                        return;
                    }

                    try {
                        if (type === 'metadata') await this.analyzeModel.analyzeMetadata(target);
                        else await this.analyzeModel.analyzeTsInfo(target);
                        this.job.analyzed++;
                    } catch (err: any) {
                        // 1 件失敗しても残りは続行する (ファイル欠損・壊れた TS など)
                        this.job.failed++;
                        if (this.job.failed <= VideoAnalyzeJobModel.LOG_LIMIT) {
                            this.log?.system.warn(
                                `video analyze job failed: type ${type}: videoFileId ${target}: ${err?.message ?? err}`,
                            );
                        }
                    }
                    this.job.processed++;
                }

                // 全件モードは同じ行を引き続けないよう読み進める。
                // 未解析のみのモードは解析に成功したぶんが対象から外れるので、
                // 「失敗して残ったまま」の件数だけ読み飛ばす (失敗ファイルで無限ループしないようにする)
                offset = mode === 'all' ? offset + targets.length : this.job.failed;
            }

            this.finish('succeeded');
        } catch (err: any) {
            this.job.error = err instanceof Error ? err.message : String(err);
            this.finish('failed');
            this.log?.system.error('video analyze job aborted');
            this.log?.system.error(err);
        }
    }

    /**
     * 解析対象の video file id を取り出す
     */
    private async findTargets(
        type: apid.VideoAnalyzeJobType,
        mode: apid.VideoAnalyzeJobMode,
        offset: number,
    ): Promise<apid.VideoFileId[]> {
        const size = VideoAnalyzeJobModel.CHUNK_SIZE;
        if (type === 'metadata') {
            const videos =
                mode === 'all'
                    ? await this.videoFileDB.findAllPaged(size, offset)
                    : await this.videoFileDB.findWithoutMetadata(size, offset);

            return videos.map(v => v.id);
        }

        const videos =
            mode === 'all'
                ? await this.videoFileTsInfoDB.findAllAnalyzable(size, offset)
                : await this.videoFileTsInfoDB.findWithoutTsInfo(size, offset);

        return videos.map(v => v.id);
    }

    /**
     * ジョブを終了状態にする
     */
    private finish(status: apid.VideoAnalyzeJobStatus): void {
        this.job.status = status;
        this.job.finishedAt = Date.now();
        this.cancelRequested = false;
        this.log?.system.info(
            `video analyze job ${status}: type ${this.job.type} mode ${this.job.mode} ` +
                `analyzed ${this.job.analyzed} failed ${this.job.failed}`,
        );
    }
}
