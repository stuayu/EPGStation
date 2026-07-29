import { fileTypeFromFile } from 'file-type';
import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IIPCClient from '../../ipc/IIPCClient';
import IApiUtil from '../IApiUtil';
import IPlayList from '../IPlayList';
import VideoFile from '../../../db/entities/VideoFile';
import IVideoApiModel, {
    AnalyzeVideoFilesResult,
    VideoFileMetadataResult,
    VideoFileMetadataStatus,
    VideoFilePathInfo,
} from './IVideoApiModel';
import IVideoUtil from './IVideoUtil';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    // 一括解析の既定件数 / 上限件数
    private static readonly ANALYZE_DEFAULT_LIMIT = 100;
    private static readonly ANALYZE_MAX_LIMIT = 1000;
    // 一括解析で失敗理由をログに残す件数 (16000 件規模でログを埋めないため)
    private static readonly ANALYZE_LOG_LIMIT = 3;

    private configuration: IConfiguration;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private apiUtil: IApiUtil;
    private videoUtil: IVideoUtil;
    private ipc: IIPCClient;
    private log: ILogger | null;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('ILoggerModel') logger?: ILoggerModel,
    ) {
        this.configuration = configuration;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.apiUtil = apiUtil;
        this.videoUtil = videoUtil;
        this.ipc = ipc;
        this.log = typeof logger === 'undefined' ? null : logger.getLogger();
    }

    /**
     * 指定した video fie id のファイルパスを返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFilePathInfo | null>
     */
    public async getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null> {
        const fullPath = await this.videoUtil.getFullFilePathFromId(videoFileId);

        return fullPath === null
            ? null
            : {
                  path: fullPath,
                  mime: await this.createMime(fullPath),
              };
    }

    /**
     * 指定されたファイルパスからファイルの mime を返す
     * @param filePath: string ファイルパス
     * @return Promise<string>
     */
    private async createMime(filePath: string): Promise<string> {
        const mime = await fileTypeFromFile(filePath);
        if (typeof mime !== 'undefined') {
            return mime.mime;
        }

        switch (path.extname(filePath)) {
            case '.m2ts':
            case '.ts':
                return 'video/mp2t';
            default:
                throw new Error('MimeTypeError');
        }
    }

    /**
     * 指定した videoFileId の m3u8 形式プレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure: boolean https 通信か
     * @param videoFileId: apid.VideoFileId
     * @return Promise<IPlayList | null>
     */
    public async getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null || typeof video.recordedId === 'undefined') {
            return null;
        }

        const recorded = await this.recordedDB.findId(video?.recordedId);
        if (recorded === null) {
            return null;
        }

        return {
            name: encodeURIComponent(path.basename(video.filePath) + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: recorded.name,
                duration: Math.floor(recorded.duration / 1000),
                baseUrl: `/api/videos/${videoFileId}`,
            }),
        };
    }

    /**
     * 指定した video file id のファイルを削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void> {
        await this.ipc.recorded.deleteVideoFile(videoFileId);
    }

    /**
     * 指定した video file id のファイルの動画長を取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 秒
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        // 解析済みなら DB の実測値を使う (ffprobe を毎回走らせない)
        if (video.analyzedAt !== null && typeof video.duration === 'number' && video.duration > 0) {
            return video.duration;
        }

        const metadata = await this.analyzeMetadata(videoFileId);

        return metadata.duration === null ? 0 : metadata.duration;
    }

    /**
     * 指定した video file id のメタデータを返す。未解析ならその場で解析する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFileMetadataResult>
     */
    public async getMetadata(videoFileId: apid.VideoFileId): Promise<VideoFileMetadataResult> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        return video.analyzedAt === null ? await this.analyzeMetadata(videoFileId) : this.toMetadataResult(video);
    }

    /**
     * 指定した video file id の実ファイルを ffprobe で解析して DB に保存する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFileMetadataResult>
     */
    public async analyzeMetadata(videoFileId: apid.VideoFileId): Promise<VideoFileMetadataResult> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const filePath = this.videoUtil.getFullFilePathFromVideoFile(video);
        if (filePath === null) {
            // config.yml の recorded に無いディレクトリ名を DB が指している場合に起きる
            throw new Error(`VideoFilePathIsUndefined (parentDirectoryName: ${video.parentDirectoryName}, filePath: ${video.filePath})`);
        }

        const info = await this.videoUtil.getDetailedInfo(filePath);

        await this.videoFileDB.updateMetadata(videoFileId, {
            duration: info.duration > 0 ? info.duration : null,
            startTime: info.startTime,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            width: info.width,
            height: info.height,
            bitRate: info.bitRate > 0 ? info.bitRate : null,
            size: info.size,
        });

        // 録画ファイル先頭の実時刻が未記録なら推定して埋める
        let startAt = video.startAt === null || typeof video.startAt === 'undefined' ? null : Number(video.startAt);
        if (startAt === null) {
            startAt = await this.estimateStartAt(video, filePath, info.duration);
            if (startAt !== null) {
                await this.videoFileDB.updateStartAt(videoFileId, startAt);
            }
        }

        return {
            videoFileId: videoFileId,
            duration: info.duration > 0 ? info.duration : null,
            startTime: info.startTime,
            startAt: startAt,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            width: info.width,
            height: info.height,
            bitRate: info.bitRate > 0 ? info.bitRate : null,
            size: info.size > 0 ? info.size : video.size,
        };
    }

    /**
     * 未解析の録画ファイルをまとめて解析する
     * @param limit: number | undefined 一度に解析する上限件数
     * @return Promise<AnalyzeVideoFilesResult>
     */
    public async analyzeAllMetadata(limit?: number): Promise<AnalyzeVideoFilesResult> {
        const max = Math.min(
            typeof limit === 'number' && limit > 0 ? Math.floor(limit) : VideoApiModel.ANALYZE_DEFAULT_LIMIT,
            VideoApiModel.ANALYZE_MAX_LIMIT,
        );

        const targets = await this.videoFileDB.findWithoutMetadata(max);

        let analyzed = 0;
        let failed = 0;
        for (const target of targets) {
            try {
                await this.analyzeMetadata(target.id);
                analyzed++;
            } catch (err: any) {
                // 1 件失敗しても残りは続行する (ファイル欠損・壊れた TS など)
                // 全件失敗する設定不備 (ffprobe のパス誤り・録画ディレクトリ名の不一致) に気付けるよう
                // 先頭数件だけ理由を残す
                failed++;
                if (failed <= VideoApiModel.ANALYZE_LOG_LIMIT) {
                    this.log?.system.warn(`video file metadata analysis failed: videoFileId ${target.id}: ${err?.message ?? err}`);
                }
            }
        }

        return {
            analyzed: analyzed,
            failed: failed,
            remaining: await this.videoFileDB.countWithoutMetadata(),
        };
    }

    /**
     * 録画ファイルのメタデータ解析状況を返す
     * @return Promise<VideoFileMetadataStatus>
     */
    public async getMetadataStatus(): Promise<VideoFileMetadataStatus> {
        const total = await this.videoFileDB.countAll();
        const unanalyzed = await this.videoFileDB.countWithoutMetadata();

        return {
            total: total,
            analyzed: total - unanalyzed,
            unanalyzed: unanalyzed,
        };
    }

    /**
     * 録画ファイル先頭 (再生位置 0 秒) に対応する実時刻を推定する
     * 録画完了ファイルは「最終更新時刻 - 実測尺」が録画開始時刻に相当する
     * @param video: VideoFile
     * @param filePath: string 実ファイルパス
     * @param duration: number 実測尺 (秒)
     * @return Promise<number | null> 推定できなければ null
     */
    private async estimateStartAt(video: VideoFile, filePath: string, duration: number): Promise<number | null> {
        const recorded = await this.recordedDB.findId(video.recordedId);

        // 録画中はファイル末尾が録画終了時刻にならないので推定しない
        if (recorded !== null && recorded.isRecording === true) {
            return null;
        }

        if (duration > 0) {
            try {
                const stats = await fs.stat(filePath);

                return Math.round(stats.mtimeMs - duration * 1000);
            } catch (err: any) {
                // stat に失敗した場合は番組開始時刻へフォールバックする
            }
        }

        return recorded === null ? null : Number(recorded.startAt);
    }

    /**
     * DB のビデオファイル情報を API のメタデータ形式に変換する
     * @param video: VideoFile
     * @return VideoFileMetadataResult
     */
    private toMetadataResult(video: VideoFile): VideoFileMetadataResult {
        return {
            videoFileId: video.id,
            duration: video.duration ?? null,
            startTime: video.startTime ?? null,
            startAt: video.startAt === null || typeof video.startAt === 'undefined' ? null : Number(video.startAt),
            videoCodec: video.videoCodec ?? null,
            audioCodec: video.audioCodec ?? null,
            width: video.width ?? null,
            height: video.height ?? null,
            bitRate: video.bitRate ?? null,
            size: video.size,
        };
    }

    public async sendToKodi(
        host: string,
        isSecure: boolean,
        kodiName: string,
        videoFileId: apid.VideoFileId,
    ): Promise<void> {
        host = this.apiUtil.getHost(host);

        // kodiName で指定された kodi host を config から探す
        const config = this.configuration.getConfig();
        if (typeof config.kodiHosts === 'undefined') {
            throw new Error('KodiHostsIsUndefined');
        }
        const kodi = config.kodiHosts.find(k => {
            return k.name === kodiName;
        });
        if (typeof kodi === 'undefined') {
            throw new Error('KodiHostIsUndefined');
        }

        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const source = `${isSecure ? 'https' : 'http'}://${host}/api/videos/${videoFileId}`;

        return this.apiUtil.sendToKodi(source, kodi);
    }
}
