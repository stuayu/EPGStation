import { inject, injectable } from 'inversify';
import { mkdirp } from 'mkdirp';
import * as path from 'path';
import * as apid from '../../../../api';
import DropLogFile from '../../../db/entities/DropLogFile';
import Recorded from '../../../db/entities/Recorded';
import Thumbnail from '../../../db/entities/Thumbnail';
import VideoFile from '../../../db/entities/VideoFile';
import FileUtil from '../../../util/FileUtil';
import StrUtil from '../../../util/StrUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IChannelDB from '../../db/IChannelDB';
import IDropLogFileDB from '../../db/IDropLogFileDB';
import IRecordedDB from '../../db/IRecordedDB';
import IRecordedHistoryDB from '../../db/IRecordedHistoryDB';
import IThumbnailDB from '../../db/IThumbnailDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IWatchHistoryDB from '../../db/IWatchHistoryDB';
import IRecordedEvent from '../../event/IRecordedEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordingManageModel from '../recording/IRecordingManageModel';
import ImportPathValidator from '../../recorded/import/ImportPathValidator';
import IRecordedManageModel, {
    AddVideoFileOption,
    ImportedExternalRecordedFileOption,
    ImportedExternalRecordedFileResult,
    UploadedVideoFileOption,
} from './IRecordedManageModel';
import IRecordingUtilModel from '../recording/IRecordingUtilModel';
import ITsInfoAnalyzer, { TsInfo } from '../../recorded/ts/ITsInfoAnalyzer';
import IVideoFileAnalyzeModel from '../../video/IVideoFileAnalyzeModel';

@injectable()
class RecordedManageModel implements IRecordedManageModel {
    // PSI/SI を保持しうる拡張子 (tsreplace 出力のように fileType が encoded でも .ts なら解析できる)
    private static readonly TS_FILE_EXTENSION = '.ts';

    private log: ILogger;
    private config: IConfigFile;
    private recordedDB: IRecordedDB;
    private channelDB: IChannelDB;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private dropLogFileDB: IDropLogFileDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private watchHistoryDB: IWatchHistoryDB;
    private recordingManageModel: IRecordingManageModel;
    private recordedEvent: IRecordedEvent;
    private videoUtil: IVideoUtil;
    private recordingUtilModel: IRecordingUtilModel;
    private tsInfoAnalyzer: ITsInfoAnalyzer;
    private videoFileAnalyzeModel: IVideoFileAnalyzeModel;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IDropLogFileDB') dropLogFileDB: IDropLogFileDB,
        @inject('IRecordedHistoryDB') recordedHistoryDB: IRecordedHistoryDB,
        @inject('IWatchHistoryDB') watchHistoryDB: IWatchHistoryDB,
        @inject('IRecordingManageModel')
        recordingManageModel: IRecordingManageModel,
        @inject('IRecordedEvent') recordedEvent: IRecordedEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IRecordingUtilModel') recordingUtilModel: IRecordingUtilModel,
        @inject('ITsInfoAnalyzer') tsInfoAnalyzer: ITsInfoAnalyzer,
        @inject('IVideoFileAnalyzeModel') videoFileAnalyzeModel: IVideoFileAnalyzeModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.recordedDB = recordedDB;
        this.channelDB = channelDB;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.dropLogFileDB = dropLogFileDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.watchHistoryDB = watchHistoryDB;
        this.recordingManageModel = recordingManageModel;
        this.recordedEvent = recordedEvent;
        this.videoUtil = videoUtil;
        this.recordingUtilModel = recordingUtilModel;
        this.tsInfoAnalyzer = tsInfoAnalyzer;
        this.videoFileAnalyzeModel = videoFileAnalyzeModel;
    }

    /**
     * 指定した録画情報と各種ファイルを削除する
     * @param recordedId: RecordedId
     * @param isIgnoreProtection: boolean
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId, isIgnoreProtection: boolean = false): Promise<void> {
        this.log.system.info(`delete recorded: ${recordedId}`);
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            this.log.system.warn(`${recordedId} is null`);
            throw new Error('RecordedIdIsNotFound');
        }

        // プロテクトチェック
        if (recorded.isProtected === true) {
            this.log.system.warn(`${recordedId} is protected`);
            throw new Error('RecordedIsProtected');
        }

        // 録画中なら停止
        if (
            isIgnoreProtection === false &&
            recorded.isRecording === true &&
            recorded.reserveId !== null &&
            this.recordingManageModel.hasReserve(recorded.reserveId) === true
        ) {
            this.log.system.info(
                `cancel recording by recorded manager reserveId: ${recorded.reserveId} recordedId: ${recorded.id}`,
            );
            await this.recordingManageModel.cancel(recorded.reserveId, true);
        }

        const hasThumbnails = typeof recorded.thumbnails !== 'undefined' && recorded.thumbnails.length > 0;
        const hasVideoFiles = typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length > 0;

        // サムネイル実ファイル削除
        if (hasThumbnails === true && typeof recorded.thumbnails !== 'undefined') {
            for (const t of recorded.thumbnails) {
                const filePath = this.getThumbnailPath(t);
                this.log.system.info(`delete: ${filePath}`);
                await FileUtil.unlink(filePath).catch(err => {
                    this.log.system.error(`failed to delete ${filePath}`);
                    this.log.system.error(err);
                });
            }
        }

        // 録画ファイル実ファイル削除 (register モードで取り込んだ外部ファイルは実ファイルを削除せず登録解除のみ行う)
        if (hasVideoFiles === true && typeof recorded.videoFiles !== 'undefined') {
            for (const v of recorded.videoFiles) {
                if (v.isExternalFile === true) {
                    this.log.system.info(`skip deleting external file (register mode): video file id ${v.id}`);
                    continue;
                }

                let filePath: string | null;
                try {
                    filePath = await this.videoUtil.getFullFilePathFromId(v.id);
                    if (filePath === null) {
                        throw new Error('GetVideoFilePathError');
                    }
                } catch (err: any) {
                    this.log.system.error(`get video file path error: ${v.id}`);
                    this.log.system.error(err);
                    this.log.system.error(v);
                    continue;
                }

                this.log.system.info(`delete: ${filePath}`);
                await FileUtil.unlink(filePath).catch(err => {
                    this.log.system.error(`failed to delete ${filePath}`);
                    this.log.system.error(err);
                });
            }
        }

        // ドロップログファイル削除処理
        if (typeof recorded.dropLogFile !== 'undefined' && recorded.dropLogFile !== null) {
            const filePath = this.getDropLogFilePath(recorded.dropLogFile);
            this.log.system.info(`delete: ${filePath}`);
            await FileUtil.unlink(filePath).catch(err => {
                this.log.system.error(`failed to delete ${filePath}`);
                this.log.system.error(err);
            });
        }

        // DB からサムネイル情報削除
        if (hasThumbnails === true) {
            this.thumbnailDB.deleteRecordedId(recordedId).catch(err => {
                this.log.system.error(`falied to delete thumbnail data: ${recordedId}`);
                this.log.system.error(err);
            });
        }

        // DB から録画ファイル情報削除
        if (hasVideoFiles === true) {
            await this.videoFileDB.deleteRecordedId(recordedId).catch(err => {
                this.log.system.error(`falied to delete video data: ${recordedId}`);
                this.log.system.error(err);
            });
        }

        // DB から視聴履歴情報削除 (孤児レコード防止)
        await this.watchHistoryDB.deleteByRecordedId(recordedId).catch(err => {
            this.log.system.error(`falied to delete watch history data: ${recordedId}`);
            this.log.system.error(err);
        });

        // DB から録画情報削除
        await this.recordedDB.deleteOnce(recordedId).catch(err => {
            this.log.system.error(`falied to delete recorded data: ${recordedId}`);
            this.log.system.error(err);
        });

        // DB からドロップログファイル情報削除
        if (typeof recorded.dropLogFile !== 'undefined' && recorded.dropLogFile !== null) {
            await this.dropLogFileDB.deleteOnce(recorded.dropLogFile.id).catch(err => {
                this.log.system.error(`failed to delete drop log data: ${recorded.dropLogFile?.id}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info(`successful delete recorded: ${recordedId}`);

        // イベント発行
        this.recordedEvent.emitDeleteRecorded(recorded);
    }

    /**
     * サムネイルファイルパス取得
     * @param thumbnail: Thumbnail
     * @return string
     */
    private getThumbnailPath(thumbnail: Thumbnail): string {
        return path.join(this.config.thumbnail, thumbnail.filePath);
    }

    /**
     * ドロップログファイルパス取得
     * @param dropLogFile: DropLogFile
     * @return string
     */
    private getDropLogFilePath(dropLogFile: DropLogFile): string {
        return path.join(this.config.dropLog, dropLogFile.filePath);
    }

    /**
     * 指定されて video file id のファイルサイズを更新する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>;
     */
    public async updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void> {
        this.log.system.info(`update video file size: ${videoFileId}`);

        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        const fileSize = await FileUtil.getFileSize(filePath);

        await this.videoFileDB.updateSize(videoFileId, fileSize);

        this.recordedEvent.emitUpdateVideoFileSize(videoFileId);
    }

    /**
     * option で指定されたビデオファイルを追加する
     * @param option: AddVideoFileOption
     * @return Promise<apid.VideoFileId>
     */
    public async addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId> {
        this.log.system.info(`add video file: ${option.recordedId} ${option.filePath}`);

        const parentDirPath = this.videoUtil.getParentDirPath(option.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(`parent directory is null: ${option.parentDirectoryName}`);
            throw new Error('ParentDirectoryIsNull');
        }

        const fileSize = await FileUtil.getFileSize(path.join(parentDirPath, option.filePath));

        const videoFile = new VideoFile();
        videoFile.parentDirectoryName = option.parentDirectoryName;
        videoFile.filePath = option.filePath;
        videoFile.type = option.type;
        videoFile.name = option.name;
        videoFile.size = fileSize;
        videoFile.recordedId = option.recordedId;
        videoFile.isExternalFile = option.isExternalFile === true;

        const newVideoFileId = await this.videoFileDB.insertOnce(videoFile).catch(err => {
            this.log.system.error(`failed to add video: ${option.parentDirectoryName}/${option.filePath}`);
            this.log.system.error(err);
            throw err;
        });

        this.recordedEvent.emitAddVideoFile(newVideoFileId);

        return newVideoFileId;
    }

    /**
     * option で指定されたビデオファイルを追加する
     * @param option: UploadedVideoFileInfo
     * @return Promise<void>
     */
    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<apid.RecordedId> {
        this.log.system.info(`add uploaded file: ${option.recordedId ?? 'auto'}`);

        // recorded id が指定されていない場合は TS を解析して番組情報を作る
        // (放送 TS には放送局・番組名・時刻がすべて入っているため、画面から入力させる必要が無い)
        let recordedId = option.recordedId;
        let isNewRecorded = false;
        if (typeof recordedId === 'undefined') {
            try {
                recordedId = await this.createRecordedFromUploadedTsFile(option);
                isNewRecorded = true;
            } catch (err: any) {
                await RecordedManageModel.unlinkUploadedFile(option);
                throw err;
            }
        }

        // 指定された番組情報を取得
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            await RecordedManageModel.unlinkUploadedFile(option);
            throw new Error('RecordedIdIsNull');
        }

        // 親ディレクトリ
        const parentDirPath = this.videoUtil.getParentDirPath(option.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(`parent directory is null: ${option.parentDirectoryName}`);
            if (typeof option.filePath !== 'undefined') {
                await FileUtil.unlink(option.filePath).catch(() => {});
            }
            throw new Error('ParentDirectoryIsNull');
        }

        // サブディレクトリ
        let dirPath = parentDirPath;
        if (typeof option.subDirectory !== 'undefined') {
            dirPath = path.join(
                dirPath,
                await this.recordingUtilModel.formatFilePathString(option.subDirectory, recorded),
            );

            // check dir
            try {
                await FileUtil.stat(dirPath);
            } catch (err: any) {
                // mkdirp directory
                this.log.system.info(`mkdirp: ${dirPath}`);
                await mkdirp(dirPath);
            }
        }

        // アップロードファイルのローカスパスが指定されていれば、そちらのファイル名を使いパスを生成する
        // コピー先のファイルパスを生成する
        let filePath: string | undefined;
        if (typeof option.localFilePath !== 'undefined') {
            const fileName = path.basename(option.localFilePath);
            filePath = await this.getUploadedVideoFilePath(dirPath, fileName);
        } else if (typeof option.fileName !== 'undefined') {
            filePath = await this.getUploadedVideoFilePath(dirPath, option.fileName);
        }

        if (typeof filePath === 'undefined') {
            throw new Error('File path could not be determined');
        }

        if (typeof option.localFilePath !== 'undefined') {
            // アップロードファイルのローカルデータを直接EPGStationファイル内の録画管理フォルダに移動
            try {
                this.log.system.info(`move file ${option.localFilePath} -> ${filePath}`);
                await FileUtil.rename(option.localFilePath, filePath);
            } catch (error) {
                // move を試す
                try {
                    await FileUtil.move(option.localFilePath, filePath);
                } catch (e: any) {
                    this.log.system.error('move file error');
                    this.log.system.error(e);
                    await FileUtil.unlink(option.localFilePath).catch(() => {});

                    throw new Error('FileMoveError');
                }
            }
        } else {
            // アップロードされたファイルを保存先へ移動する
            if (typeof option.filePath === 'undefined') {
                throw new Error('File path could not be determined');
            }
            try {
                this.log.system.info(`move file ${option.filePath} -> ${filePath}`);
                await FileUtil.rename(option.filePath, filePath);
            } catch (err: any) {
                // move を試す
                try {
                    await FileUtil.move(option.filePath, filePath);
                } catch (e: any) {
                    this.log.system.error('move file error');
                    this.log.system.error(e);
                    await FileUtil.unlink(option.filePath).catch(() => {});

                    throw new Error('FileMoveError');
                }
            }
        }

        // DB に反映
        try {
            const fileName = path.basename(filePath);
            const videoFileId = await this.addVideoFile({
                recordedId: recordedId,
                parentDirectoryName: option.parentDirectoryName,
                filePath:
                    typeof option.subDirectory === 'undefined'
                        ? fileName
                        : path.join(
                              await this.recordingUtilModel.formatFilePathString(option.subDirectory, recorded),
                              fileName,
                          ),
                type: option.fileType,
                name: option.viewName,
            });

            // TS の PSI/SI 解析 + ffprobe による実測メタデータの取得 (失敗しても登録は成功のまま)
            await this.videoFileAnalyzeModel.analyzeAll(videoFileId);

            // 通知
            const needsCreateThumbnail = typeof recorded.thumbnails === 'undefined' || recorded.thumbnails.length === 0;
            this.recordedEvent.emitAddUploadedVideoFile(videoFileId, needsCreateThumbnail, recordedId);
        } catch (err: any) {
            await FileUtil.unlink(filePath).catch(() => {});
            // 自動生成した番組情報は動画が登録できなければ残す意味が無い
            if (isNewRecorded === true) {
                await this.delete(recordedId, true).catch(() => {});
            }
            throw err;
        }

        return recordedId;
    }

    /**
     * アップロードされた TS ファイルを解析し、番組情報を新規作成する。
     *
     * 放送 TS の PSI/SI には放送局 (SDT/NIT)・番組名・開始時刻・尺・ジャンル (EIT[p/f]) が
     * 入っているため、画面から番組情報を入力させずに登録できる。
     * 解析できなかった場合は番組情報を作れないので例外を投げる
     * @param option: UploadedVideoFileOption
     * @return Promise<apid.RecordedId>
     */
    private async createRecordedFromUploadedTsFile(option: UploadedVideoFileOption): Promise<apid.RecordedId> {
        const filePath = option.localFilePath ?? option.filePath;
        if (typeof filePath === 'undefined') {
            throw new Error('File path could not be determined');
        }

        // 対象判定は fileType ではなく拡張子で行う。
        // tsreplace 系 (映像だけ差し替え済みで出力拡張子は .ts のまま) は fileType が encoded でも
        // PSI/SI を保持しているため、番組情報を取り出せる。
        // 完全な再マルチプレクス (.mp4/.mkv 等) には PSI/SI が無いので画面から入力してもらう
        const name = option.fileName ?? path.basename(filePath);
        if (path.extname(name).toLowerCase() !== RecordedManageModel.TS_FILE_EXTENSION) {
            throw new Error('RecordedIdIsRequired');
        }

        const tsInfo = await this.tsInfoAnalyzer.analyze(filePath).catch(err => {
            this.log.system.warn(`ts info analyze failed: ${filePath}`);
            this.log.system.warn(err instanceof Error ? err.message : String(err));

            return null;
        });
        if (tsInfo === null) {
            throw new Error('TsInfoAnalyzeError');
        }

        // 放送局は network id + service id での厳密な引き当てだけを使う (取り違えると実況や番組表がずれる)
        const channel =
            tsInfo.networkId === null || tsInfo.serviceId === null
                ? null
                : await this.channelDB.findNetworkIdAndServiceId(tsInfo.networkId, tsInfo.serviceId).catch(() => null);
        if (channel === null) {
            throw new Error('ChannelIsNotFound');
        }

        const baseName = path.parse(name).name;
        const startAt = tsInfo.eventStartAt ?? tsInfo.firstTdtAt;
        if (startAt === null) {
            throw new Error('StartAtIsNotFound');
        }

        // 番組長が取れない場合は実測尺で補う
        let endAt: number;
        if (tsInfo.eventDuration !== null) {
            endAt = startAt + tsInfo.eventDuration * 1000;
        } else {
            const info = await this.videoUtil.getInfo(filePath);
            endAt = startAt + Math.max(1000, Math.round(info.duration * 1000));
        }

        const createOption: apid.CreateNewRecordedOption = {
            channelId: channel.id,
            startAt: startAt,
            endAt: endAt,
            name: tsInfo.eventName ?? baseName,
        };
        RecordedManageModel.applyTsInfoToCreateOption(createOption, tsInfo);

        this.log.system.info(`create recorded from ts: ${createOption.name} (${channel.name})`);

        return await this.createNewRecorded(createOption);
    }

    /**
     * TS 解析結果 (EIT[p/f]) の番組情報を新規録画作成オプションへ写す。
     *
     * EPGStation で録画した番組は Mirakurun の番組情報から概要・詳細・ジャンル 3 組・
     * 映像音声情報まで入るため、取り込み・アップロードでも同じ項目を埋めて表示差を無くす
     * @param createOption: apid.CreateNewRecordedOption 書き込み先
     * @param tsInfo: TsInfo TS 解析結果
     */
    private static applyTsInfoToCreateOption(createOption: apid.CreateNewRecordedOption, tsInfo: TsInfo): void {
        if (tsInfo.eventDescription !== null) {
            createOption.description = tsInfo.eventDescription;
        }
        if (tsInfo.eventExtended !== null) {
            createOption.extended = tsInfo.eventExtended;
        }

        // ジャンルは EIT の content_descriptor に最大 3 組載る
        const genreKeys: Array<['genre1' | 'genre2' | 'genre3', 'subGenre1' | 'subGenre2' | 'subGenre3']> = [
            ['genre1', 'subGenre1'],
            ['genre2', 'subGenre2'],
            ['genre3', 'subGenre3'],
        ];
        genreKeys.forEach(([genreKey, subGenreKey], i) => {
            const genre = tsInfo.genres[i];
            if (typeof genre === 'undefined') {
                return;
            }
            createOption[genreKey] = genre.lv1;
            createOption[subGenreKey] = genre.lv2;
        });

        if (tsInfo.videoType !== null) {
            createOption.videoType = tsInfo.videoType as apid.ProgramVideoType;
        }
        if (tsInfo.videoResolution !== null) {
            createOption.videoResolution = tsInfo.videoResolution as apid.ProgramVideoResolution;
        }
        if (tsInfo.videoStreamContent !== null) {
            createOption.videoStreamContent = tsInfo.videoStreamContent;
        }
        if (tsInfo.videoComponentType !== null) {
            createOption.videoComponentType = tsInfo.videoComponentType;
        }
        if (tsInfo.audioSamplingRate !== null) {
            createOption.audioSamplingRate = tsInfo.audioSamplingRate as apid.ProgramAudioSamplingRate;
        }
        if (tsInfo.audioComponentType !== null) {
            createOption.audioComponentType = tsInfo.audioComponentType;
        }
    }

    /**
     * アップロード済みの一時ファイルを削除する (登録に失敗した場合の後始末)
     */
    private static async unlinkUploadedFile(option: UploadedVideoFileOption): Promise<void> {
        if (typeof option.filePath !== 'undefined') {
            await FileUtil.unlink(option.filePath).catch(() => {});
        }
    }

    /**
     * アップロードファイルの file path を取得する
     * @param dir: directory
     * @param fileName: file name
     * @param conflict: 同名ファイルがあった場合カウントされる
     * @return string
     */
    private async getUploadedVideoFilePath(dir: string, fileName: string, conflict: number = 0): Promise<string> {
        const extname = path.extname(fileName);
        const name = fileName.slice(0, fileName.length - extname.length);
        const count = conflict > 0 ? `(${conflict})` : '';

        const filePath = path.join(dir, `${name}${count}${extname}`);

        try {
            // 同盟のファイルが存在するか確認
            await FileUtil.stat(filePath);

            return this.getUploadedVideoFilePath(dir, fileName, conflict + 1);
        } catch (err: any) {
            return filePath;
        }
    }

    /**
     * 外部録画ファイル (EDCB 等) を取り込む
     * localFilePath は必ず IConfigFile.importDirs 配下の実パス (シンボリックリンク解決後) であることを検証したうえで処理する
     * @param options: ImportedExternalRecordedFileOption[]
     * @return Promise<ImportedExternalRecordedFileResult[]>
     */
    public async importExternalRecordedFiles(
        options: ImportedExternalRecordedFileOption[],
    ): Promise<ImportedExternalRecordedFileResult[]> {
        const importDirs = this.config.importDirs ?? [];
        const results: ImportedExternalRecordedFileResult[] = [];

        for (const option of options) {
            let recordedId: apid.RecordedId | null = null;
            let isNewRecorded = false;

            try {
                // パス検証 (importDirs 外・シンボリックリンク経由の脱出・.. トラバーサルを拒否する)
                const resolved = await ImportPathValidator.resolveImportTargetPath(option.localFilePath, importDirs);
                if (typeof option.subDirectory !== 'undefined') {
                    ImportPathValidator.validateSubDirectory(option.subDirectory);
                }

                const stats = await FileUtil.stat(resolved.realPath);
                if (stats.isFile() === false) {
                    throw new Error('ExternalFileIsNotFile');
                }

                const parsed = path.parse(resolved.realPath);
                const duplicateAction = option.duplicateAction ?? 'newRecorded';

                // 重複としてスキップする場合は動画情報の解析すら行わず早期リターンする (ffprobe のコスト削減)
                if (duplicateAction === 'skip') {
                    results.push({ localFilePath: option.localFilePath, imported: false, skipped: true });
                    continue;
                }

                // TS の PSI/SI から放送局・番組情報を取り出す (ファイル名や program.txt の推定より正確)
                const tsInfo = await this.analyzeTsInfoForImport(option, resolved.realPath);

                const startAt =
                    typeof option.startAt === 'number'
                        ? option.startAt
                        : (tsInfo?.eventStartAt ?? Math.floor(stats.mtimeMs));
                const name =
                    typeof option.name === 'string' && option.name.length > 0
                        ? option.name
                        : (tsInfo?.eventName ?? parsed.name);

                let endAt = option.endAt;
                if (typeof endAt !== 'number') {
                    if (tsInfo !== null && tsInfo.eventDuration !== null) {
                        endAt = startAt + tsInfo.eventDuration * 1000;
                    } else {
                        const info = await this.videoUtil.getInfo(resolved.realPath);
                        endAt = startAt + Math.max(1000, Math.round(info.duration * 1000));
                    }
                }

                if (duplicateAction === 'add' && typeof option.duplicateRecordedId === 'number') {
                    recordedId = option.duplicateRecordedId;
                } else {
                    const createOption: apid.CreateNewRecordedOption = {
                        channelId: await this.resolveImportChannelId(option, tsInfo),
                        startAt,
                        endAt,
                        name,
                    };
                    if (typeof option.ruleId === 'number') {
                        createOption.ruleId = option.ruleId;
                    }
                    // 番組の概要・詳細・ジャンル・映像音声情報は画面から指定できないため、TS から取れた値をそのまま使う
                    if (tsInfo !== null) {
                        RecordedManageModel.applyTsInfoToCreateOption(createOption, tsInfo);
                    }
                    // 画面から指定されたジャンルは TS 由来の値より優先する
                    if (typeof option.genre1 === 'number') {
                        createOption.genre1 = option.genre1;
                    }
                    if (typeof option.subGenre1 === 'number') {
                        createOption.subGenre1 = option.subGenre1;
                    }
                    recordedId = await this.createNewRecorded(createOption);
                    isNewRecorded = true;
                }

                const mode = option.mode ?? this.config.importDefaultMode ?? 'register';

                if (mode === 'move') {
                    // 録画ディレクトリへ移動する (既存のアップロード処理を再利用する)
                    await this.addUploadedVideoFile({
                        recordedId,
                        parentDirectoryName: option.parentDirectoryName,
                        subDirectory: option.subDirectory,
                        viewName: parsed.base,
                        fileType: option.fileType,
                        localFilePath: resolved.realPath,
                    });
                } else {
                    // register モード: 実ファイルには一切触れず、importDirs のエントリ名 + 相対パスで登録する
                    const videoFileId = await this.addVideoFile({
                        recordedId,
                        parentDirectoryName: resolved.dirName,
                        filePath: resolved.relativePath,
                        type: option.fileType,
                        name: parsed.base,
                        isExternalFile: true,
                    });

                    // 解析済みの TS 情報を保存し、続けて ffprobe で実測メタデータを取る
                    await this.saveAnalyzedInfo(videoFileId, tsInfo);

                    const recorded = await this.recordedDB.findId(recordedId);
                    const needsCreateThumbnail =
                        recorded === null ||
                        typeof recorded.thumbnails === 'undefined' ||
                        recorded.thumbnails.length === 0;
                    this.recordedEvent.emitAddUploadedVideoFile(videoFileId, needsCreateThumbnail, recordedId);
                }

                results.push({ localFilePath: option.localFilePath, imported: true, recordedId, name });
            } catch (err: any) {
                // 新規作成した recorded がある場合のみロールバックする。register モードでは実ファイルは一切操作していないため安全
                if (isNewRecorded === true && recordedId !== null) {
                    await this.delete(recordedId, true).catch(() => {});
                }
                results.push({
                    localFilePath: option.localFilePath,
                    imported: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        return results;
    }

    /**
     * 取り込み対象ファイルの TS を解析する
     * 解析に失敗しても取り込み自体は続行させたいので、失敗時は null を返す
     * @param option: ImportedExternalRecordedFileOption
     * @param filePath: string 実ファイルパス
     * @return Promise<TsInfo | null>
     */
    private async analyzeTsInfoForImport(
        option: ImportedExternalRecordedFileOption,
        filePath: string,
    ): Promise<TsInfo | null> {
        // エンコード済みファイルには PSI/SI が無い
        if (option.fileType !== 'ts') {
            return null;
        }

        try {
            return await this.tsInfoAnalyzer.analyze(filePath);
        } catch (err: any) {
            this.log.system.warn(`ts info analyze failed: ${filePath}`);
            this.log.system.warn(err instanceof Error ? err.message : String(err));

            return null;
        }
    }

    /**
     * 取り込み先の放送局を決める
     * TS から network id / service id が取れた場合はそちらを優先する
     * (ファイル名の放送局名からの推定より確実なため)
     * @param option: ImportedExternalRecordedFileOption
     * @param tsInfo: TsInfo | null
     * @return Promise<apid.ChannelId>
     */
    private async resolveImportChannelId(
        option: ImportedExternalRecordedFileOption,
        tsInfo: TsInfo | null,
    ): Promise<apid.ChannelId> {
        if (tsInfo === null || tsInfo.networkId === null || tsInfo.serviceId === null) {
            return option.channelId;
        }

        const channel = await this.channelDB
            .findNetworkIdAndServiceId(tsInfo.networkId, tsInfo.serviceId)
            .catch(() => null);

        return channel === null ? option.channelId : channel.id;
    }

    /**
     * 取り込んだビデオファイルの解析結果を保存する
     * 解析済みの TS 情報があればそれを保存し、続けて ffprobe による実測メタデータを取る
     * 取り込み自体は成功しているので、失敗しても例外は投げない
     * @param videoFileId: apid.VideoFileId
     * @param tsInfo: TsInfo | null
     * @return Promise<void>
     */
    private async saveAnalyzedInfo(videoFileId: apid.VideoFileId, tsInfo: TsInfo | null): Promise<void> {
        if (tsInfo !== null) {
            await this.videoFileAnalyzeModel.saveTsInfo(videoFileId, tsInfo).catch(err => {
                this.log.system.warn(`save ts info failed: videoFileId ${videoFileId}`);
                this.log.system.warn(err instanceof Error ? err.message : String(err));
            });
        }

        await this.videoFileAnalyzeModel.analyzeMetadata(videoFileId).catch(err => {
            this.log.system.warn(`video metadata analyze failed: videoFileId ${videoFileId}`);
            this.log.system.warn(err instanceof Error ? err.message : String(err));
        });
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        this.log.system.info('create new recorded');

        const recorded = new Recorded();
        recorded.isRecording = false;
        recorded.isProtected = false;
        if (typeof option.ruleId !== 'undefined') {
            recorded.ruleId = option.ruleId;
        }
        recorded.channelId = option.channelId;

        // 録画時点の放送局名を保持する (channel テーブルから放送局情報が失われた後の表示用)
        try {
            const channel = await this.channelDB.findId(option.channelId);
            if (channel !== null) {
                recorded.channelName = channel.name;
                recorded.halfWidthChannelName = channel.halfWidthName;
            }
        } catch (err: any) {
            this.log.system.warn(`get channel name error: ${option.channelId}`);
            this.log.system.warn(err);
        }

        recorded.startAt = option.startAt;
        recorded.endAt = option.endAt;
        if (option.startAt - option.endAt >= 0) {
            throw new Error('TimeRangeError');
        }
        recorded.duration = option.endAt - option.startAt;
        recorded.name = StrUtil.toDBStr(option.name);
        recorded.halfWidthName = StrUtil.toHalf(option.name);
        if (typeof option.description !== 'undefined') {
            recorded.description = StrUtil.toDBStr(option.description);
            recorded.halfWidthDescription = StrUtil.toHalf(recorded.description);
        }
        if (typeof option.extended !== 'undefined') {
            recorded.extended = StrUtil.toDBStr(option.extended);
            recorded.halfWidthExtended = StrUtil.toHalf(recorded.extended);
        }
        if (typeof option.genre1 !== 'undefined') {
            recorded.genre1 = option.genre1;
        }
        if (typeof option.subGenre1 !== 'undefined') {
            recorded.subGenre1 = option.subGenre1;
        }
        if (typeof option.genre2 !== 'undefined') {
            recorded.genre2 = option.genre2;
        }
        if (typeof option.subGenre2 !== 'undefined') {
            recorded.subGenre2 = option.subGenre2;
        }
        if (typeof option.genre3 !== 'undefined') {
            recorded.genre3 = option.genre3;
        }
        if (typeof option.subGenre3 !== 'undefined') {
            recorded.subGenre3 = option.subGenre3;
        }
        // 映像・音声情報 (EPGStation で録画した番組と同じ項目を TS 解析からも埋める)
        if (typeof option.videoType !== 'undefined') {
            recorded.videoType = option.videoType;
        }
        if (typeof option.videoResolution !== 'undefined') {
            recorded.videoResolution = option.videoResolution;
        }
        if (typeof option.videoStreamContent !== 'undefined') {
            recorded.videoStreamContent = option.videoStreamContent;
        }
        if (typeof option.videoComponentType !== 'undefined') {
            recorded.videoComponentType = option.videoComponentType;
        }
        if (typeof option.audioSamplingRate !== 'undefined') {
            recorded.audioSamplingRate = option.audioSamplingRate;
        }
        if (typeof option.audioComponentType !== 'undefined') {
            recorded.audioComponentType = option.audioComponentType;
        }

        const recordedId = await this.recordedDB.insertOnce(recorded).catch(err => {
            this.log.system.error(err);
            throw err;
        });

        this.log.system.info(`created new recorded: ${recordedId}`);

        this.recordedEvent.emitCreateNewRecorded(recordedId);

        return recordedId;
    }

    /**
     * 指定された video file id のファイルを削除する
     * @param videoFileid: apid.VideoFileId
     * @param isIgnoreProtection: boolean
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileid: apid.VideoFileId, isIgnoreProtection: boolean = false): Promise<void> {
        this.log.system.info(`delete video file: ${videoFileid}`);

        const video = await this.videoFileDB.findId(videoFileid);
        if (video === null) {
            this.log.system.info(`video file is not found: ${videoFileid}`);
            throw new Error('VideoFileIsNotFound');
        }

        // プロテクトがかかっているか確認
        let recorded = await this.recordedDB.findId(video.recordedId);
        if (isIgnoreProtection === false && recorded !== null && recorded.isProtected === true) {
            this.log.system.warn(`${videoFileid} is protected`);
            throw new Error('RecordedIsProtected');
        }

        // 録画中の場合は録画情報ごと削除
        if (recorded?.isRecording === true) {
            return await this.delete(video.recordedId, false);
        }

        // 実ファイル削除 (register モードで取り込んだ外部ファイルは削除せず登録解除のみ行う)
        if (video.isExternalFile === true) {
            this.log.system.info(`skip deleting external file (register mode): video file id ${videoFileid}`);
        } else {
            const filePath = await this.videoUtil.getFullFilePathFromId(videoFileid);
            if (filePath !== null) {
                this.log.system.info(`delete: ${filePath}`);
                await FileUtil.unlink(filePath).catch(err => {
                    this.log.system.error(`failed to delete ${filePath}`);
                    this.log.system.error(err);
                });
            }
        }

        // DB から削除
        await this.videoFileDB.deleteOnce(videoFileid);

        // DB から視聴履歴情報削除 (孤児レコード防止)
        await this.watchHistoryDB.deleteByVideoFileId(videoFileid).catch(err => {
            this.log.system.error(`falied to delete watch history data: ${videoFileid}`);
            this.log.system.error(err);
        });

        // video に紐付けられていた recorded が空かチェック
        recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded !== null && typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length === 0) {
            // 空だったので recorded も削除
            this.log.system.info(`empty video files: ${video.recordedId}`);
            await this.delete(video.recordedId, false);
        } else {
            this.recordedEvent.emitDeleteVideoFile(videoFileid);
        }
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public async changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        this.log.system.info((isProtect === true ? 'set protect' : 'remove protect') + `: ${recordedId}`);

        await this.recordedDB.changeProtect(recordedId, isProtect);
        this.recordedEvent.emitChangeProtect(recordedId, isProtect);
    }

    /**
     * RecordedHistory の保存期間外のデータを削除する
     * @return Promise<void>
     */
    public async historyCleanup(): Promise<void> {
        const date = new Date().getTime() - this.config.recordedHistoryRetentionPeriodDays * 24 * 60 * 60 * 1000;
        await this.recordedHistoryDB.delete(date).catch(err => {
            this.log.system.error('failed to historyCleanup');
            this.log.system.error(err);
        });
    }

    /**
     * DB 未登録の動画実ファイル・ディレクトリと、DB 上に存在するが実ファイルが存在しない video file を洗い出す
     * 実削除は行わない (副作用なし)
     * @return Promise<{ orphanFiles: string[]; orphanDirectories: string[]; missingDBVideoFiles: VideoFile[] }>
     */
    private async scanOrphanVideoFiles(): Promise<{
        orphanFiles: string[];
        orphanDirectories: string[];
        missingDBVideoFiles: VideoFile[];
    }> {
        const videoFiles = await this.videoFileDB.findAll();

        // ファイル, ディレクトリ索引生成 & DB 上に存在するが実ファイルが存在しないデータの洗い出し
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        const dirIndex: { [dirPath: string]: boolean } = {}; // ディレクトリ索引
        const missingDBVideoFiles: VideoFile[] = [];
        for (const video of videoFiles) {
            const videoFilePath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (videoFilePath === null) {
                continue;
            }

            if ((await this.checkFileExistence(videoFilePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[videoFilePath] = true;
                const parentDir = path.dirname(videoFilePath).replace(new RegExp(`\\${path.sep}$`), '');
                dirIndex[parentDir] = true;
            } else {
                // ファイルが存在しないなら削除候補に追加
                missingDBVideoFiles.push(video);
            }
        }

        // 実ファイルリストを取得する
        const list: FileUtil.FileList = {
            files: [],
            directories: [],
        };
        for (const r of this.config.recorded) {
            const l = await FileUtil.getFileList(r.path);
            Array.prototype.push.apply(list.files, l.files);
            Array.prototype.push.apply(list.directories, l.directories);
            dirIndex[r.path] = true; // 親ディレクトリを索引に追加
        }
        // ディレクトリ削除時にネストが深いディレクトリから削除するためにソート
        list.directories.sort((dir1, dir2) => {
            return dir2.length - dir1.length;
        });

        // 索引上に存在しないファイル・ディレクトリ (= DB 未登録) を抽出する
        const orphanFiles = list.files.filter(file => typeof fileIndex[file] === 'undefined');
        const orphanDirectories = list.directories.filter(dir => typeof dirIndex[dir] === 'undefined');

        return { orphanFiles, orphanDirectories, missingDBVideoFiles };
    }

    /**
     * DB 未登録のドロップログ実ファイルと、DB 上に存在するが実ファイルが存在しない drop log を洗い出す
     * 実削除は行わない (副作用なし)
     * @return Promise<{ orphanFiles: string[]; missingDBDropLogs: DropLogFile[] }>
     */
    private async scanOrphanDropLogFiles(): Promise<{ orphanFiles: string[]; missingDBDropLogs: DropLogFile[] }> {
        const dropLogs = await this.dropLogFileDB.findAll();

        // ファイル索引生成 & DB 上に存在するが実ファイルが存在しないデータの洗い出し
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        const missingDBDropLogs: DropLogFile[] = [];
        for (const dropLog of dropLogs) {
            const filePath = this.getDropLogFilePath(dropLog);

            if ((await this.checkFileExistence(filePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[filePath] = true;
            } else {
                // ファイルが存在しないなら削除候補に追加
                missingDBDropLogs.push(dropLog);
            }
        }

        // 索引上に存在しないファイル (= DB 未登録) を抽出する
        const list = await FileUtil.getFileList(this.config.dropLog);
        const orphanFiles = list.files.filter(file => typeof fileIndex[file] === 'undefined');

        return { orphanFiles, missingDBDropLogs };
    }

    /**
     * クリーンアップ (削除) 対象の情報を実削除せずに取得する
     * @return Promise<apid.RecordedCleanupInfo>
     */
    public async getCleanupInfo(): Promise<apid.RecordedCleanupInfo> {
        const { orphanFiles: orphanVideoFiles } = await this.scanOrphanVideoFiles();
        const { orphanFiles: orphanDropLogFiles } = await this.scanOrphanDropLogFiles();

        // 削除候補の動画実ファイルの合計サイズを算出する
        let totalSize = 0;
        for (const file of orphanVideoFiles) {
            try {
                totalSize += await FileUtil.getFileSize(file);
            } catch (err: any) {
                // ファイルサイズが取得できなくても無視する
            }
        }

        return {
            videoFiles: {
                count: orphanVideoFiles.length,
                sampleFilePaths: orphanVideoFiles.slice(0, RecordedManageModel.CLEANUP_INFO_SAMPLE_COUNT),
                totalSize: totalSize,
            },
            dropLogs: {
                count: orphanDropLogFiles.length,
                sampleFilePaths: orphanDropLogFiles.slice(0, RecordedManageModel.CLEANUP_INFO_SAMPLE_COUNT),
            },
        };
    }

    /**
     * DB に登録されていない recorded 下のファイル削除 &  DB に登録されているが存在しない番組情報の削除
     * @return Promise<void>
     */
    public async videoFileCleanup(): Promise<void> {
        this.log.system.info('start video files cleanup');

        const { orphanFiles, orphanDirectories, missingDBVideoFiles } = await this.scanOrphanVideoFiles();

        // DB 上に存在するが実ファイルが存在しないデータを削除する
        for (const video of missingDBVideoFiles) {
            await this.deleteVideoFile(video.id).catch(() => {});
        }

        // ファイル索引上に存在しないファイルを削除する
        for (const file of orphanFiles) {
            this.log.system.info(`delete file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to delete file: ${file}`);
                this.log.system.error(err);
            });
        }

        // ディレクトリ索引上に存在しないディレクトリを削除する
        for (const dir of orphanDirectories) {
            this.log.system.info(`delete directory: ${dir}`);
            try {
                // ディレクトリが空かチェック
                if ((await FileUtil.isEmptyDirectory(dir)) === true) {
                    await FileUtil.rmdir(dir);
                } else {
                    this.log.system.warn(`directory is not empty: ${dir}`);
                }
            } catch (err: any) {
                this.log.system.error(`failed to delete directory: ${dir}`);
                this.log.system.error(err);
            }
        }

        this.log.system.info('start video files cleanup completed');
    }

    /**
     * DB に登録されていないログファイル削除 &  DB に登録されているが存在しないログ情報の削除
     */
    public async dropLogFileCleanup(): Promise<void> {
        this.log.system.info('start drop log files cleanup');

        const { orphanFiles, missingDBDropLogs } = await this.scanOrphanDropLogFiles();

        // DB 上に存在するが実ファイルが存在しないデータを削除する
        for (const dropLog of missingDBDropLogs) {
            this.log.system.warn(`drop file is not exist: ${this.getDropLogFilePath(dropLog)}`);
            try {
                await this.recordedDB.removeDropLogFileId(dropLog.id);
                await this.dropLogFileDB.deleteOnce(dropLog.id);
            } catch (err: any) {
                this.log.system.error(err);
            }
        }

        // ファイル索引上に存在しないファイルを削除する
        for (const file of orphanFiles) {
            this.log.system.info(`delete drop log file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to drop log file: ${file}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info('start drop log files cleanup completed');
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

    /**
     * 指定された ruleId を録画情報から削除する
     * @param ruleId: apid.Rule
     */
    public async removeRuleId(ruleId: apid.RuleId): Promise<void> {
        await this.recordedDB.removeRuleId(ruleId);
    }
}

namespace RecordedManageModel {
    // getCleanupInfo で返す代表ファイルパスの最大件数
    export const CLEANUP_INFO_SAMPLE_COUNT = 5;
}

export default RecordedManageModel;
