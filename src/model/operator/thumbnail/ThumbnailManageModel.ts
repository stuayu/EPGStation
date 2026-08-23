import { spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Thumbnail from '../../../db/entities/Thumbnail';
import FileUtil from '../../../util/FileUtil';
import ProcessUtil from '../../../util/ProcessUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IRecordedDB from '../../db/IRecordedDB';
import IThumbnailDB from '../../db/IThumbnailDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IThumbnailEvent from '../../event/IThumbnailEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { IPromiseQueue } from '../../IPromiseQueue';
import IThumbnailManageModel from './IThumbnailManageModel';
import { createThumbnailCandidates } from './ThumbnailCandidateGenerator';
import ThumbnailExtractor from './ThumbnailExtractor';
import ThumbnailImageAnalyzer, { ThumbnailImageFeatures } from './ThumbnailImageAnalyzer';
import BasicThumbnailScorer from './ThumbnailScorer';

@injectable()
export default class ThumbnailManageModel implements IThumbnailManageModel {
    // 同じ動画で生成に失敗し続けたときに諦める回数。
    // 定期クリーンアップが「サムネイルの無い録画」を毎回拾うため、
    // これが無いと壊れたファイル 1 件で永久にエラーログが出続ける
    private static readonly MAX_FAILURE_COUNT = 3;
    // 失敗時にログへ出す ffmpeg の stderr の行数 (原因が分からないと直せないため)
    private static readonly STDERR_LOG_LINES = 10;
    // 長時間TSの候補解析はキーフレーム探索とデコードに時間がかかるため、
    // 30分番組でも十分な1時間を上限とする。プロセス停止不能時の無限待機は防ぐ。
    private static readonly FFMPEG_TIMEOUT_MS = 60 * 60 * 1000;

    private log: ILogger;
    private config: IConfigFile;
    private queue: IPromiseQueue;
    private recordedDB: IRecordedDB;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private thumbnailEvent: IThumbnailEvent;
    private videoUtil: IVideoUtil;
    private extractor = new ThumbnailExtractor();
    private analyzer = new ThumbnailImageAnalyzer();
    private scorer = new BasicThumbnailScorer();
    // 生成に失敗した回数 (videoFileId 単位)。プロセス再起動でリセットされる
    private failureCount: { [videoFileId: number]: number } = {};

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IPromiseQueue') queue: IPromiseQueue,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IThumbnailEvent') thumbnailEvent: IThumbnailEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.queue = queue;
        this.recordedDB = recordedDB;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.thumbnailEvent = thumbnailEvent;
        this.videoUtil = videoUtil;
    }

    /**
     * サムネイル作成 Queue に追加する
     * @param videoFileId: apid.VideoFileId
     */
    public add(videoFileId: apid.VideoFileId, profile?: 'fast' | 'balanced' | 'quality'): void {
        // 失敗し続けている動画は諦める。
        // (定期クリーンアップが毎回拾うため、放置するとエラーログが延々と出る)
        const failureCount = this.failureCount[videoFileId] ?? 0;
        if (failureCount >= ThumbnailManageModel.MAX_FAILURE_COUNT) {
            this.log.system.debug(`skip thumbnail queue (failed ${failureCount} times): ${videoFileId}`);

            return;
        }

        this.log.system.info(`add thumbnail queue: ${videoFileId}`);

        this.queue.add<void>(() => {
            return this.create(videoFileId, profile)
                .then(() => {
                    delete this.failureCount[videoFileId];
                })
                .catch(err => {
                    const count = (this.failureCount[videoFileId] ?? 0) + 1;
                    this.failureCount[videoFileId] = count;
                    this.log.system.error(
                        `create thumbnail error: ${videoFileId} (${count}/${ThumbnailManageModel.MAX_FAILURE_COUNT})`,
                    );
                    this.log.system.error(err);
                    if (count >= ThumbnailManageModel.MAX_FAILURE_COUNT) {
                        this.log.system.warn(
                            `give up creating thumbnail: ${videoFileId} (retry after restarting or re-adding the video)`,
                        );
                    }
                });
        });
    }

    /**
     * サムネイル生成をして生成したファイルを Thumbnail に登録する
     * @param videoFileId: apid.VideoFileId
     */
    private async create(videoFileId: apid.VideoFileId, profile?: 'fast' | 'balanced' | 'quality'): Promise<void> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        const videoFilePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (videoFile === null || videoFilePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        // check thumbnail dir
        const thumbnailRoot = this.config.thumbnailStorageRoot || this.config.thumbnail;
        try {
            await FileUtil.access(thumbnailRoot, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err: any) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.system.warn(`mkdirp: ${thumbnailRoot}`);
                await FileUtil.mkdir(thumbnailRoot);
            } else {
                // アクセス権に Read or Write が無い
                this.log.system.fatal(`thumbnail dir permission error: ${thumbnailRoot}`);
                this.log.system.fatal(err);
                throw err;
            }
        }

        const format = this.config.thumbnailFormat === 'webp' ? 'webp' : 'jpeg';
        const extension = format === 'webp' ? 'webp' : 'jpg';
        const fileName = await this.getSaveFileName(videoFile.recordedId, 0, `poster.${extension}`);
        const output = path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, fileName);
        const candidates = createThumbnailCandidates(
            videoFile.duration ?? 0,
            profile === 'fast' ? 5 : profile === 'quality' ? 50 : this.config.thumbnailCandidateCount ?? 20,
            this.config.thumbnailPosition,
        );
        let selectedTimestamp = candidates[Math.floor(candidates.length / 2)]?.timestamp ?? this.config.thumbnailPosition;
        let selectedScore: number | null = null;
        let selectedFeatures: ThumbnailImageFeatures | null = null;
        if (profile !== 'fast') {
            try {
                const frames = await this.extractor.extract(this.config.ffmpeg, videoFilePath, videoFile.duration ?? 0, profile === 'quality' ? 50 : this.config.thumbnailCandidateCount ?? 20);
                if (frames.length === 0) {
                    selectedTimestamp = Math.min(videoFile.duration ?? this.config.thumbnailPosition, Math.max(0, this.config.thumbnailPosition));
                }
                for (const frame of frames) {
                    const features = this.analyzer.analyze(frame.data, frame.width, frame.height);
                    const score = this.scorer.score({ brightness: features.brightness, contrast: features.contrast, sharpness: features.sharpness, sceneChange: features.edge, blackPenalty: features.blackRatio * 50, blurPenalty: 0, features }, { videoFile });
                    this.log.system.debug(JSON.stringify({ timestamp: frame.timestamp, ...features, score }));
                    if (selectedScore === null || score > selectedScore) {
                        selectedScore = score;
                        selectedTimestamp = frame.timestamp;
                        selectedFeatures = features;
                    }
                }
            } catch (err) {
                this.log.system.warn(`thumbnail candidate analysis failed, fallback: ${videoFileId}`);
                this.log.system.debug(err);
            }
        }
        // 低品質候補は legacy 位置、次に中央、最後に取得済み候補へフォールバック。
        if (selectedScore !== null && selectedScore < 15) {
            selectedTimestamp = Math.min(videoFile.duration ?? this.config.thumbnailPosition, Math.max(0, this.config.thumbnailPosition));
            selectedScore = null;
            selectedFeatures = null;
        }
        const cmdStr = this.config.thumbnailCmd.replace(/%FFMPEG%/g, this.config.ffmpeg);
        const cmds = ProcessUtil.parseCmdStr(cmdStr);

        // コマンドの引数準備
        for (let i = 0; i < cmds.args.length; i++) {
            cmds.args[i] = cmds.args[i]
                .replace(/%INPUT%/, videoFilePath)
                .replace(/%OUTPUT%/, output)
                .replace(/%THUMBNAIL_POSITION%/, `${selectedTimestamp.toString(10)}`)
                .replace(/%THUMBNAIL_SIZE%/, this.getPosterSize());
        }

        // run ffmpeg
        const child = spawn(cmds.bin, cmds.args);
        const processTimer = setTimeout(() => {
            this.log.system.warn(`thumbnail ffmpeg timeout: ${videoFileId}`);
            child.kill();
        }, ThumbnailManageModel.FFMPEG_TIMEOUT_MS);

        // 失敗時に原因をログへ出せるよう、末尾だけ控えておく
        let stderrLines: string[] = [];
        if (child.stderr !== null) {
            child.stderr.on('data', data => {
                const text = String(data);
                this.log.system.debug(text);
                stderrLines = stderrLines
                    .concat(text.split(/\r?\n/).filter(line => line.trim().length > 0))
                    .slice(-ThumbnailManageModel.STDERR_LOG_LINES);
            });
        }
        if (child.stdout !== null) {
            child.stdout.on('data', () => {});
        }

        // プロセス終了処理
        const endProcessing = async (code: number | null): Promise<boolean> => {
            if (code !== 0) {
                this.log.system.error(`create thumbnail cmd error: ${code}, input: ${videoFilePath}`);
                if (stderrLines.length > 0) {
                    this.log.system.error(`thumbnail cmd stderr: ${stderrLines.join(' / ')}`);
                }

                return false;
            }
            this.log.system.info(`create thumbnail: ${videoFileId}, ${output}`);

            // add DB
            const thumbnail = new Thumbnail();
            thumbnail.filePath = fileName;
            thumbnail.recordedId = videoFile.recordedId;
            thumbnail.variant = 'poster';
            thumbnail.format = format;
            thumbnail.timestamp = selectedTimestamp;
            thumbnail.score = selectedScore;
            thumbnail.width = this.parseWidth(this.getPosterSize());
            thumbnail.height = this.parseHeight(this.getPosterSize());
            try {
                await this.thumbnailDB.insertOnce(thumbnail);
            } catch (err: any) {
                this.log.system.error(`thumbnail add DB error: ${videoFileId}`);
                this.log.system.error(err);

                // delete thumbnail file
                await FileUtil.unlink(output).catch(err => {
                    this.log.system.error(`thumbnail delete error: ${videoFileId}, ${output}`);
                    this.log.system.error(err);
                });
                return false;
            }

            // V1 wide は同じ選択フレームを互換的に保持。後続版で個別リサイズへ拡張。
            const wideName = await this.getSaveFileName(videoFile.recordedId, 0, `wide.${extension}`);
            const widePath = path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, wideName);
            await this.resize(output, widePath, 640);
            const wide = new Thumbnail();
            wide.filePath = wideName;
            wide.recordedId = videoFile.recordedId;
            wide.variant = 'wide';
            wide.format = format;
            wide.timestamp = thumbnail.timestamp;
            wide.score = thumbnail.score;
            wide.width = 640;
            wide.height = thumbnail.height === null || thumbnail.width === null ? null : Math.round(thumbnail.height * 640 / thumbnail.width);
            await this.thumbnailDB.insertOnce(wide).catch(async () => {
                await FileUtil.unlink(widePath).catch(() => undefined);
                this.log.system.error(`wide thumbnail add DB error: ${videoFileId}`);
            });

            const metaDir = path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, 'meta');
            await FileUtil.mkdir(metaDir);
            await fs.promises.writeFile(path.join(metaDir, `${videoFile.recordedId}.json`), JSON.stringify({
                generator: 'v1.5', selectedTimestamp, score: selectedScore, features: selectedFeatures,
            }, null, 2), 'utf8');

            // event emit
            this.thumbnailEvent.emitAdded(videoFileId, videoFile.recordedId);

            return true;
        };

        return new Promise<void>(async (resolve: () => void, reject: (err: Error) => void) => {
            child.on('exit', async code => {
                clearTimeout(processTimer);
                if ((await endProcessing(code)) === true) {
                    resolve();
                } else {
                    reject(new Error('CreateThumbnailExitError'));
                }
            });

            child.on('error', err => {
                clearTimeout(processTimer);
                this.log.system.error(`create thumbnail failed: ${videoFileId}`);
                reject(err);
            });

            // プロセスの即時終了対応
            if (ProcessUtil.isExited(child) === true) {
                child.removeAllListeners();
                if ((await endProcessing(child.exitCode)) === true) {
                    resolve();
                } else {
                    reject(new Error('CreateThumbnailExitError'));
                }
            }
        });
    }

    /**
     * 重複しないサムネイルファイル名を返す
     * @param recordedId: recorded id
     * @param conflict: 重複数
     * @return string
     */
    private async getSaveFileName(recordedId: apid.RecordedId, conflict: number = 0, suffix = 'jpg'): Promise<string> {
        const conflictStr = conflict === 0 ? '' : `(${conflict})`;
        const fileName = `${recordedId}${conflictStr}-${suffix}`;
        const filePath = path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, fileName);

        try {
            await FileUtil.stat(filePath);

            return this.getSaveFileName(recordedId, conflict + 1, suffix);
        } catch (err: any) {
            return fileName;
        }
    }

    private parseWidth(size: string): number | null {
        const value = Number.parseInt(size.split('x')[0] ?? '', 10);
        return Number.isFinite(value) ? value : null;
    }

    private parseHeight(size: string): number | null {
        const value = Number.parseInt(size.split('x')[1] ?? '', 10);
        return Number.isFinite(value) ? value : null;
    }

    private getPosterSize(): string {
        const width = Math.max(1, this.config.thumbnailPosterWidth ?? 1280);
        const sourceWidth = this.parseWidth(this.config.thumbnailSize) ?? 16;
        const sourceHeight = this.parseHeight(this.config.thumbnailSize) ?? 9;
        return `${width}x${Math.max(1, Math.round(width * sourceHeight / sourceWidth))}`;
    }

    private resize(input: string, output: string, width: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${width}:-2`, '-frames:v', '1', '-f', 'image2', output]);
            const timer = setTimeout(() => child.kill(), ThumbnailManageModel.FFMPEG_TIMEOUT_MS);
            child.once('error', reject);
            child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ThumbnailResizeExit:${code}`)); });
        });
    }

    /**
     * 指定したサムネイルを削除する
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<void>
     */
    public async delete(thumbnailId: apid.ThumbnailId): Promise<void> {
        const thumbnail = await this.thumbnailDB.findId(thumbnailId);
        if (thumbnail === null) {
            throw new Error('ThumbnailIsNotFound');
        }

        this.log.system.info(`delete thumbnail ${thumbnailId}`);

        // DB から削除
        await this.thumbnailDB.deleteOnce(thumbnailId).catch(err => {
            this.log.system.error(`delete thumbnail error: ${thumbnailId}`);
            this.log.system.error(err);
            throw err;
        });

        // サムネイルファイルを削除
        const filePath = path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, thumbnail.filePath);
        await FileUtil.unlink(filePath).catch(err => {
            this.log.system.error(`delete thumbnail error: ${thumbnailId}`);
            this.log.system.error(err);
            throw err;
        });

        this.thumbnailEvent.emitDeleted();
    }

    /**
     * サムネイル再生性
     * @return Promise<void>
     */
    public async regenerate(): Promise<void> {
        this.log.system.info('start regenerate thumbnail');

        const [recordeds] = await this.recordedDB.findAll(
            {
                isHalfWidth: false,
            },
            {
                isNeedVideoFiles: true,
                isNeedThumbnails: true,
                isNeedsDropLog: false,
                isNeedTags: false,
            },
        );

        const videoFileIds: apid.VideoFileId[] = []; // サムネイル再生成リスト
        for (const recorded of recordeds) {
            if (typeof recorded.videoFiles === 'undefined' || recorded.videoFiles.length === 0) {
                continue;
            }

            if (typeof recorded.thumbnails === 'undefined' || recorded.thumbnails.length === 0) {
                // サムネイルが存在しないので生成リストに追加
                videoFileIds.push(recorded.videoFiles[0].id);
                continue;
            }

            // ファイルが存在しないサムネイルデータを列挙する
            const nonExistingThumbnailIds: apid.ThumbnailId[] = [];
            let existingThumbnailCnt = 0;

            // サムネイルファイルが存在するか確認
            for (const thumbnail of recorded.thumbnails) {
                const thumbnailPath = path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, thumbnail.filePath);
                try {
                    await FileUtil.stat(thumbnailPath);
                    // ファイルが存在するので無視
                    existingThumbnailCnt++;
                    continue;
                } catch (err: any) {
                    // ファイルが存在しない
                    nonExistingThumbnailIds.push(thumbnail.id);
                }
            }

            // 存在しないサムネイルデータを削除する
            for (const thumbnailId of nonExistingThumbnailIds) {
                await this.thumbnailDB.deleteOnce(thumbnailId).catch(err => {
                    this.log.system.error(`failed to delete non-existing thumbnail data: ${thumbnailId}`);
                    this.log.system.error(err);
                });
            }

            // サムネイル情報が存在しなくなったので生成リストに追加
            if (existingThumbnailCnt === 0) {
                videoFileIds.push(recorded.videoFiles[0].id);
            }
        }

        // 再生成リストにある videoFileId からサムネイルを再生成させる
        for (const videoFileId of videoFileIds) {
            this.add(videoFileId);
        }
    }

    /** 指定録画のサムネイルを削除して再生成する。 */
    public async regenerateRecorded(
        recordedId: apid.RecordedId,
        profile?: 'fast' | 'balanced' | 'quality',
    ): Promise<void> {
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null || recorded.videoFiles === undefined || recorded.videoFiles.length === 0) {
            throw new Error('RecordedIsNotFound');
        }

        await this.replaceRecorded(recordedId, recorded.videoFiles[0].id, profile);
    }

    /**
     * 指定録画のサムネイルを削除し、指定動画ファイルから再生成する
     * @param recordedId: apid.RecordedId
     * @param videoFileId: apid.VideoFileId
     * @param profile: 生成プロファイル
     * @return Promise<void>
     */
    public async replaceRecorded(
        recordedId: apid.RecordedId,
        videoFileId: apid.VideoFileId,
        profile?: 'fast' | 'balanced' | 'quality',
    ): Promise<void> {
        const recorded = await this.recordedDB.findId(recordedId);
        if (
            recorded === null ||
            recorded.videoFiles === undefined ||
            recorded.videoFiles.some(videoFile => videoFile.id === videoFileId) === false
        ) {
            throw new Error('VideoFileIsNotFound');
        }

        const thumbnails = recorded.thumbnails ?? [];
        for (const thumbnail of thumbnails) {
            await this.thumbnailDB.deleteOnce(thumbnail.id).catch(() => undefined);
            await FileUtil.unlink(
                path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, thumbnail.filePath),
            ).catch(() => undefined);
        }
        // profile は V1 では候補数だけに反映し、基本設定を恒久変更しない。
        this.add(videoFileId, profile);
    }

    /**
     * DB に登録されていないログファイル削除 &  DB に登録されているが存在しないログ情報の削除
     */
    public async fileCleanup(): Promise<void> {
        this.log.system.info('start thumbnail files cleanup');
        const thumbnails = await this.thumbnailDB.findAll();

        // ファイル, ディレクトリ索引生成と DB 上に存在するが実ファイルが存在しないデータを削除する
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        for (const thumbnail of thumbnails) {
            const filePath = path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, thumbnail.filePath);

            if ((await this.checkFileExistence(filePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[filePath] = true;
            } else {
                this.log.system.warn(`thumbnail file is not exist: ${filePath}`);
                // ファイルが存在しないなら削除
                await this.thumbnailDB.deleteOnce(thumbnail.id).catch(err => {
                    this.log.system.error(err);
                });
            }
        }

        // ファイル索引上に存在しないファイルを削除する
        const list = await FileUtil.getFileList(this.config.thumbnailStorageRoot || this.config.thumbnail);
        for (const file of list.files) {
            if (typeof fileIndex[file] !== 'undefined') {
                continue;
            }

            this.log.system.info(`delete thumbnail file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to thumbnail file: ${file}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info('start thumbnail files cleanup completed');
    }

    /**
     * 指定したファイルパスにファイルが存在するか
     * @param filePath: string ファイルパス
     * @return Promise<boolean> ファイルが存在するなら true を返す
     */
    private async checkFileExistence(filePath: string): Promise<boolean> {
        try {
            await FileUtil.stat(filePath);

            return true;
        } catch (err: any) {
            return false;
        }
    }
}
